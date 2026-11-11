/* ============================================================
   sync.js — همگام‌سازی رکورد به رکورد بین گوشی و ویندوز
   نسخه ۲ — بازنویسی‌شده روی معماری IndexedDB اپ (پایگاه sb_data)

   نصب: فقط یک خط، بعد از اسکریپت اصلی، درست قبل از </body>
       <script src="sync.js"></script>
   هیچ تغییری در index.html لازم نیست.

   چطور کار می‌کند
   ---------------
   ۱. توابع سراسری persist / save / del اپ را می‌پوشاند.
   ۲. برای هر رکورد یک اثر انگشت (hash) نگه می‌دارد. هر رکوردی که
      محتوایش عوض شود، فیلد u (مهر زمانی) می‌گیرد. پس تغییر از هر
      مسیری — فرم، پیامک، تحلیل Claude، حضور و غیاب — دیده می‌شود.
   ۳. حذف‌ها در فهرست سنگ‌قبر (__sync_tomb) ثبت می‌شوند تا به
      دستگاه دیگر هم منتقل شوند. بدون این، حذف‌شده دوباره برمی‌گردد.
   ۴. فقط رکوردهای تغییریافته رد و بدل می‌شود. در تضاد، رکورد با u
      بزرگ‌تر می‌ماند.
   ۵. روی COLS اپ حلقه می‌زند، نه روی فهرست ثابت. هر مجموعه‌ی جدیدی
      که بعداً به اپ اضافه شود، خودکار همگام می‌شود.

   آنچه همگام نمی‌شود: عکس‌ها (انبار IndexedDB جدا) و تنظیمات محلی.
   ============================================================ */
(function () {
  "use strict";
  if (window.__sbSync) return;

  var _persist = window.persist, _del = window.del, _vSet = window.vSet;
  if (!_persist || !_del) { console.warn("sync.js: هسته اپ پیدا نشد."); return; }

  var MKEY = "__sync_meta", TKEY = "__sync_tomb", SKEY = "__sync_shadow";
  var TOMB_DAYS = 120, PAGE = 1500;

  var meta = { dev: "", push: 0, cursor: 0, at: 0, err: "" };
  var shadow = {};        // col -> { id: hash }
  var tombs = [];         // [{c,id,u}]
  var ready = false, busy = false, applying = false, timer = null, saveT = null;

  /* ---------- کمک‌ها ---------- */
  function cfg() { try { return (typeof LS !== "undefined" ? LS.get("syncCfg", {}) : {}) || {}; } catch (e) { return {}; } }
  function appCfg() { try { return (typeof LS !== "undefined" ? LS.get("cfg", {}) : {}) || {}; } catch (e) { return {}; } }
  function token() { return cfg().token || appCfg().token || ""; }
  function url() { return (cfg().url || "").replace(/\/+$/, ""); }
  function fnum(n) { try { return typeof fa === "function" ? fa(n) : String(n); } catch (e) { return String(n); } }

  function h32(s) { var h = 5381, i; for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
  function recHash(r) {
    var o = {}, k;
    for (k in r) if (k !== "u" && Object.prototype.hasOwnProperty.call(r, k)) o[k] = r[k];
    try { return h32(JSON.stringify(o, Object.keys(o).sort())); } catch (e) { return 0; }
  }

  /* ---------- متادیتا ---------- */
  async function loadMeta() {
    try {
      var m = await DBS.get(MKEY); if (m && typeof m === "object") meta = Object.assign(meta, m);
      var t = await DBS.get(TKEY); if (Array.isArray(t)) tombs = t;
      var s = await DBS.get(SKEY); if (s && typeof s === "object") shadow = s;
    } catch (e) { }
    if (!meta.dev) { meta.dev = (typeof uid === "function" ? uid() : String(Date.now())); await saveMeta(); }
  }
  function saveMeta() { return DBS.set(MKEY, meta).catch(function () { }); }
  function saveTombs() { return DBS.set(TKEY, tombs).catch(function () { }); }
  function saveShadowSoon() { clearTimeout(saveT); saveT = setTimeout(function () { DBS.set(SKEY, shadow).catch(function () { }); }, 1500); }

  /* ---------- مهر زمانی ---------- */
  function stamp(col) {
    if (applying || !S[col]) return 0;
    var old = shadow[col] || {}, seen = {}, now = Date.now(), n = 0, i, r, h;
    for (i = 0; i < S[col].length; i++) {
      r = S[col][i]; if (!r || !r.id) continue;
      h = recHash(r); seen[r.id] = h;
      if (old[r.id] !== h) { r.u = Math.max(now, (+r.u || 0) + 1); n++; }
    }
    shadow[col] = seen;
    if (n) saveShadowSoon();
    return n;
  }
  function reshadow(col) {
    var seen = {}, i, r;
    for (i = 0; i < (S[col] || []).length; i++) { r = S[col][i]; if (r && r.id) seen[r.id] = recHash(r); }
    shadow[col] = seen; saveShadowSoon();
  }
  function stampAll() { var n = 0, i; for (i = 0; i < COLS.length; i++) n += stamp(COLS[i]); return n; }
  function pending() {
    var n = 0, i, j, a;
    for (i = 0; i < COLS.length; i++) { a = S[COLS[i]] || []; for (j = 0; j < a.length; j++) if ((+a[j].u || 0) > meta.push) n++; }
    for (i = 0; i < tombs.length; i++) if (tombs[i].u > meta.push) n++;
    return n;
  }

  /* ---------- پوشاندن هسته ---------- */
  window.persist = function (col) { stamp(col); return _persist(col); };
  window.del = async function (col, id) {
    if (!applying) {
      tombs.push({ c: col, id: id, u: Date.now() });
      if (shadow[col]) delete shadow[col][id];
      saveTombs(); saveShadowSoon();
    }
    return _del(col, id);
  };

  /* ---------- ادغام ---------- */
  function tombAfter(c, id, u) {
    var i; for (i = 0; i < tombs.length; i++) if (tombs[i].c === c && tombs[i].id === id && tombs[i].u >= u) return true;
    return false;
  }
  function applyIn(res) {
    var touched = {}, c, a, i, r, k, idx;
    var chg = res.changes || {};
    for (c in chg) {
      if (!Array.isArray(S[c])) continue;            // مجموعه‌ای که این نسخه اپ نمی‌شناسد: نادیده
      a = chg[c];
      for (i = 0; i < a.length; i++) {
        r = a[i]; if (!r || !r.id) continue;
        idx = S[c].findIndex(function (x) { return x.id === r.id; });
        if (idx < 0) { if (!tombAfter(c, r.id, +r.u || 0)) { S[c].push(r); touched[c] = 1; } }
        else if ((+r.u || 0) > (+S[c][idx].u || 0)) { S[c][idx] = r; touched[c] = 1; }
      }
    }
    var tb = res.tombs || [];
    for (i = 0; i < tb.length; i++) {
      k = tb[i]; if (!k || !Array.isArray(S[k.c])) continue;
      idx = S[k.c].findIndex(function (x) { return x.id === k.id; });
      if (idx >= 0 && (+S[k.c][idx].u || 0) <= (+k.u || 0)) { S[k.c].splice(idx, 1); touched[k.c] = 1; }
      if (!tombs.some(function (t) { return t.c === k.c && t.id === k.id; })) tombs.push({ c: k.c, id: k.id, u: +k.u || 0 });
    }
    return Object.keys(touched);
  }

  function prune() {
    var lim = Date.now() - TOMB_DAYS * 864e5, before = tombs.length;
    tombs = tombs.filter(function (t) { return t.u > lim; });
    if (tombs.length !== before) saveTombs();
  }

  /* ---------- رفت و برگشت ---------- */
  async function post(body) {
    var u = url(); if (!u) throw new Error("آدرس سرور همگام‌سازی وارد نشده است.");
    if (!token()) throw new Error("رمز اپ (APP_TOKEN) وارد نشده است.");
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 45000);
    try {
      var r = await fetch(u + "/sync", {
        method: "POST", signal: ctl.signal,
        headers: { "x-app-token": token(), "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || ("کد خطا " + r.status));
      return j;
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "زمان پاسخ سرور تمام شد" : (e.message || "خطای ارتباط"));
    } finally { clearTimeout(tm); }
  }

  async function syncNow(manual) {
    if (busy) return false;
    if (!ready) { if (manual) alert("هنوز آماده نیست، چند لحظه بعد دوباره امتحان کن."); return false; }
    if (!url() || !token()) { if (manual) alert("ابتدا در تنظیمات، آدرس سرور همگام‌سازی و رمز اپ را وارد کن."); return false; }
    busy = true; setStatus("در حال همگام‌سازی...");
    try {
      stampAll(); prune();

      var since = meta.push, changes = {}, out = 0, i, j, a, arr;
      for (i = 0; i < COLS.length; i++) {
        a = S[COLS[i]] || []; arr = [];
        for (j = 0; j < a.length; j++) if ((+a[j].u || 0) > since) arr.push(a[j]);
        if (arr.length) { changes[COLS[i]] = arr; out += arr.length; }
      }
      var tOut = tombs.filter(function (t) { return t.u > since; });
      var started = Date.now(), got = 0, more = true, first = true;

      while (more) {
        var res = await post({
          app: "sobhan-beton", v: 2, device: meta.dev,
          cursor: meta.cursor, limit: PAGE,
          changes: first ? changes : {}, tombs: first ? tOut : []
        });
        first = false;
        var touched = applyIn(res);
        if (touched.length) {
          applying = true;
          for (i = 0; i < touched.length; i++) { reshadow(touched[i]); await _persist(touched[i]); }
          applying = false;
        }
        got += (res.count || 0);
        meta.cursor = res.cursor != null ? res.cursor : meta.cursor;
        more = !!res.more;
        await saveMeta();
      }

      meta.push = started; meta.at = Date.now(); meta.err = "";
      await saveMeta(); await saveTombs(); await DBS.set(SKEY, shadow).catch(function () { });

      if (typeof render === "function") render();
      if (typeof syncNotifications === "function") syncNotifications();
      setStatus("");
      if (manual) alert("همگام‌سازی انجام شد.\n" + fnum(out) + " رکورد فرستاده شد، " + fnum(got) + " رکورد گرفته شد.");
      return true;
    } catch (e) {
      meta.err = e.message || String(e); meta.at = meta.at || 0; await saveMeta(); setStatus("");
      if (manual) alert("همگام‌سازی ناموفق بود: " + meta.err);
      return false;
    } finally { busy = false; if (typeof render === "function" && !manual) render(); }
  }

  function setStatus(t) { var el = document.getElementById("syncStat"); if (el) el.textContent = t; }

  /* ---------- کارت تنظیمات ---------- */
  function card() {
    var c = cfg(), p = ready ? pending() : 0;
    var last = meta.at ? (typeof jal === "function" && typeof localISO === "function"
      ? jal(localISO(new Date(meta.at))) + " ساعت " + (typeof faNum === "function" ? faNum(new Date(meta.at).toTimeString().slice(0, 5)) : new Date(meta.at).toTimeString().slice(0, 5))
      : new Date(meta.at).toLocaleString("fa-IR")) : "هنوز انجام نشده";
    var E = typeof esc === "function" ? esc : function (x) { return String(x == null ? "" : x); };
    return '<div class="card"><h3>همگام‌سازی گوشی و ویندوز</h3>' +
      '<div class="note">داده‌ها رکورد به رکورد با سرور خودت ادغام می‌شود. برخلاف پشتیبان‌گیری، چیزی را جایگزین نمی‌کند. عکس‌ها همگام نمی‌شوند.</div>' +
      '<label>آدرس سرور همگام‌سازی</label><input id="syU" dir="ltr" placeholder="https://sync.example.com" value="' + E(c.url || "") + '">' +
      '<label>رمز اپ (اگر با سرور دستیار یکی است، خالی بگذار)</label><input id="syT" dir="ltr" type="password" value="' + E(c.token || "") + '">' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="syAuto" type="checkbox" style="width:auto" ' + (c.auto !== false ? "checked" : "") + '> همگام‌سازی خودکار هر ۱۰ دقیقه</label>' +
      '<div class="m" style="margin-top:6px">آخرین همگام‌سازی: ' + last + '</div>' +
      '<div class="m">در انتظار ارسال: <b>' + fnum(p) + '</b> رکورد</div>' +
      (meta.err ? '<div class="m" style="color:var(--bad)">آخرین خطا: ' + E(meta.err) + '</div>' : '') +
      '<div class="row" style="margin-top:9px"><button class="primary" id="syNow">همگام‌سازی الان</button>' +
      '<button class="ghost" id="sySave">ذخیره تنظیمات</button></div>' +
      '<div class="note" id="syncStat" style="margin-top:6px"></div>' +
      '<div class="note" style="margin-top:6px">شناسه این دستگاه: <span dir="ltr">' + E(meta.dev) + '</span></div></div>';
  }
  if (_vSet) window.vSet = function () { return _vSet() + card(); };

  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var g = function (n) { var el = document.getElementById(n); return el ? el.value.trim() : ""; };
    if (b.id === "sySave") {
      var el = document.getElementById("syAuto");
      LS.set("syncCfg", { url: g("syU"), token: g("syT"), auto: el ? el.checked : true });
      schedule(); setStatus("ذخیره شد."); return;
    }
    if (b.id === "syNow") {
      var e2 = document.getElementById("syAuto");
      LS.set("syncCfg", { url: g("syU"), token: g("syT"), auto: e2 ? e2.checked : true });
      b.disabled = true; await syncNow(true); b.disabled = false; schedule(); return;
    }
  });

  /* ---------- زمان‌بندی ---------- */
  function schedule() {
    clearInterval(timer); timer = null;
    if (cfg().auto === false || !url() || !token()) return;
    timer = setInterval(function () { if (navigator.onLine !== false) syncNow(false); }, 10 * 60000);
  }

  async function boot() {
    for (var i = 0; i < 60; i++) {           // منتظر پایان بارگذاری داده‌های اپ
      if (typeof S !== "undefined" && typeof COLS !== "undefined" && S[COLS[0]]) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    await loadMeta();
    if (!Object.keys(shadow).length) { for (var j = 0; j < COLS.length; j++) reshadow(COLS[j]); }
    ready = true;
    stampAll();
    schedule();
    setTimeout(function () { if (url() && token() && cfg().auto !== false) syncNow(false); }, 4000);
    window.addEventListener("online", function () { syncNow(false); });
    var A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (A) { try { A.addListener("appStateChange", function (st) { if (st && st.isActive) syncNow(false); }); } catch (e) { } }
  }

  window.__sbSync = { now: syncNow, pending: pending, meta: function () { return meta; } };
  boot();
})();
