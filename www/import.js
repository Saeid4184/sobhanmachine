/* ============================================================
   import.js — ورود گزارش‌های اکسل گذشته به اپ سبحان بتن

   نصب: کنار index.html و sync.js در پوشه www، و یک خط در انتهای
   index.html بعد از sync.js:
       <script src="import.js"></script>

   سه ورودی:
     ۱. فهرست ماشین‌آلات و رانندگان  (مثل 1405_08_18.xlsx)
     ۲. صورت تعمیرات روزانه تعمیرگاه (مثل تعمیرگاه_19.xlsx)
     ۳. تقسیم مقاطع پمپ             (همه شیت‌های ماهانه یکجا)

   هیچ‌چیز بدون پیش‌نمایش و تأیید ثبت نمی‌شود. تکراری‌ها تشخیص
   داده و رد می‌شوند، پس اگر یک فایل را دو بار بدهی مشکلی نیست.
   خواندن xlsx بدون هیچ کتابخانه‌ی بیرونی انجام می‌شود.
   ============================================================ */
(function () {
  "use strict";
  if (window.__sbImport) return;

  /* ====================== خواندن فایل xlsx ====================== */

  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function unzip(ab) {
    const b = new Uint8Array(ab), dv = new DataView(ab);
    let eo = -1;
    for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
    }
    if (eo < 0) throw new Error("فایل فشرده معتبر نیست (xlsx نیست؟)");
    const n = dv.getUint16(eo + 10, true);
    let p = dv.getUint32(eo + 16, true);
    const out = {};
    const dec = new TextDecoder("utf-8");
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(lo + 26, true), lExtra = dv.getUint16(lo + 28, true);
      const start = lo + 30 + lNameLen + lExtra;
      const raw = b.subarray(start, start + csize);
      out[name] = { method, raw };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    const files = {};
    for (const k in out) {
      const e = out[k];
      files[k] = e.method === 0 ? e.raw : await inflate(e.raw);
    }
    return files;
  }

  const TD = new TextDecoder("utf-8");
  function xml(bytes) {
    return new DOMParser().parseFromString(TD.decode(bytes), "application/xml");
  }

  /** می‌خواند و برای هر شیت آرایه‌ای از سطرها می‌دهد: {r, c:{A:"..",B:".."}} */
  async function readXlsx(file) {
    const files = await unzip(await file.arrayBuffer());
    const shared = [];
    if (files["xl/sharedStrings.xml"]) {
      const d = xml(files["xl/sharedStrings.xml"]);
      for (const si of d.getElementsByTagName("si")) {
        let s = "";
        for (const t of si.getElementsByTagName("t")) s += t.textContent;
        shared.push(s);
      }
    }
    const rels = {};
    if (files["xl/_rels/workbook.xml.rels"]) {
      const d = xml(files["xl/_rels/workbook.xml.rels"]);
      for (const r of d.getElementsByTagName("Relationship")) {
        let t = r.getAttribute("Target") || "";
        if (t.indexOf("/") !== 0 && t.indexOf("xl/") !== 0) t = "xl/" + t.replace(/^\.\//, "");
        rels[r.getAttribute("Id")] = t.replace(/^\//, "");
      }
    }
    const sheets = [];
    const wbd = xml(files["xl/workbook.xml"]);
    const list = wbd.getElementsByTagName("sheet");
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const name = el.getAttribute("name") || ("Sheet" + (i + 1));
      let rid = el.getAttribute("r:id") || el.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = rels[rid] || ("xl/worksheets/sheet" + (i + 1) + ".xml");
      if (!files[path]) path = "xl/worksheets/sheet" + (i + 1) + ".xml";
      if (!files[path]) continue;
      sheets.push({ name: name, rows: parseSheet(xml(files[path]), shared) });
    }
    return sheets;
  }

  function parseSheet(doc, shared) {
    const rows = [];
    for (const row of doc.getElementsByTagName("row")) {
      const obj = {}, rn = +row.getAttribute("r") || (rows.length + 1);
      let any = false;
      for (const c of row.getElementsByTagName("c")) {
        const ref = c.getAttribute("r") || "", col = ref.replace(/[0-9]/g, "");
        const t = c.getAttribute("t");
        let v = "";
        if (t === "inlineStr") {
          for (const x of c.getElementsByTagName("t")) v += x.textContent;
        } else {
          const vn = c.getElementsByTagName("v")[0];
          if (!vn) continue;
          v = vn.textContent;
          if (t === "s") v = shared[+v] || "";
        }
        v = String(v).trim();
        if (v !== "") { obj[col] = v; any = true; }
      }
      if (any) rows.push({ r: rn, c: obj });
    }
    return rows;
  }

  /* ====================== کمک‌ها ====================== */

  const clean = s => String(s == null ? "" : s).replace(/\u0640+/g, "").replace(/[\s\u200c]+/g, " ").trim();
  const digits = s => clean(s).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  /** "1405/08/19" یا "1405/8/9" را به تاریخ میلادی اپ تبدیل می‌کند */
  function jdate(s) {
    const m = digits(s).match(/(\d{4})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})/);
    if (!m) return "";
    const jy = +m[1], jm = +m[2], jd = +m[3];
    if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return "";
    try { return jToIso(jy, jm, jd); } catch (e) { return ""; }
  }

  function num(s) {
    const v = parseFloat(digits(s).replace(/[^\d.\-]/g, ""));
    return isFinite(v) ? v : 0;
  }

  /** سطر سرستون را پیدا می‌کند و نگاشت عنوان→ستون می‌دهد (هم دقیق، هم با کلیدواژه) */
  function header(rows, needles, limit) {
    for (let i = 0; i < Math.min(rows.length, limit || 12); i++) {
      const c = rows[i].c, map = {};
      for (const col in c) { const t = clean(c[col]); if (t && map[t] === undefined) map[t] = col; }
      let hit = 0;
      for (const n of needles) {
        if (map[n] !== undefined) { hit++; continue; }
        for (const t in map) if (t.indexOf(n) >= 0) { map[n] = map[t]; hit++; break; }
      }
      if (hit >= Math.ceil(needles.length * 0.6)) return { i: i, map: map };
    }
    return null;
  }

  const normPlate = s => digits(s).replace(/[^\dA-Za-zآ-ی]/g, "");

  /* ====================== نگاشت‌ها ====================== */

  const GRP = [
    [/میکسر/, "میکسر"], [/کمپرسی|تریلی/, "کمپرسی"], [/پمپ/, "پمپ بتن"],
    [/لودر/, "لودر"], [/کشنده|جرثقیل/, "سایر"], [/تانکر/, "تانکر آب"],
    [/بچینگ/, "بچینگ"], [/ژنراتور|دیزل/, "دیزل ژنراتور"]
  ];
  /** اگر متن یکی از گروه‌های شناخته‌شده باشد نوع را می‌دهد، وگرنه null */
  const grpOf = s => { const t = clean(s); for (const [re, v] of GRP) if (re.test(t)) return v; return null; };
  const typeOf = s => grpOf(s) || "سایر";

  function statusOf(st, drv) {
    const s = clean(st), d = clean(drv);
    if (/از خط خارج|فروش/.test(d) || /از خط خارج|فروش/.test(s)) return "غیرفعال";
    if (/تعمیر/.test(s)) return "در تعمیر";
    return "فعال";
  }

  const SECT = [
    [/فونداسیون|فنداسیون|فونداسین/, "فونداسیون"],
    [/دیوار\s*و\s*ستون|دیوارستون/, "دیوار و ستون"],
    [/^ستون/, "ستون"], [/^دیوار/, "دیوار"],
    [/سقف/, "سقف"], [/^کف/, "کف"], [/چاه/, "چاه"], [/مگر/, "مگر"],
    [/خرپشته/, "خرپشته"], [/راه\s*پله|پله/, "راه پله"], [/شمع/, "شمع"], [/رمپ/, "رمپ"]
  ];
  function sectOf(s) {
    const t = clean(s); if (!t) return "نامشخص";
    for (const [re, v] of SECT) if (re.test(t)) return v;
    return t;
  }

  /** ساعت را از متن «۲۱:۱۹» یا از عدد اکسل (کسری از شبانه‌روز) درمی‌آورد */
  function timeOf(v) {
    const t = digits(v);
    const m = t.match(/(\d{1,2}):(\d{2})/);
    if (m) return ("0" + m[1]).slice(-2) + ":" + m[2];
    const f = parseFloat(t);
    if (!isFinite(f) || f < 0) return "";
    const frac = f - Math.floor(f);
    if (f !== 0 && frac === 0) return "";
    const mins = Math.round(frac * 1440) % 1440;
    return ("0" + Math.floor(mins / 60)).slice(-2) + ":" + ("0" + (mins % 60)).slice(-2);
  }

  /* ====================== پارسرها ====================== */

  /* ۱ — فهرست ماشین‌آلات و رانندگان */
  function parseFleet(sheets) {
    const out = { machines: [], contacts: [] }, seen = {};
    for (const sh of sheets) {
      const h = header(sh.rows, ["شماره ماشین", "نوع ماشین", "نام راننده", "آخرین وضعیت"], 8);
      if (!h) continue;
      const M = h.map, lab = {};
      let group = "";
      for (let i = h.i; i < sh.rows.length; i++) {
        const c = sh.rows[i].c;
        for (const col in c) {               // عنوان گروه در ستون سمت راست جدول
          if (col < M["شماره ماشین"] && col !== M["شماره ماشین"]) {
            const t = clean(c[col]).replace(/\s/g, "");
            if (t.length > 2 && !/^\d+$/.test(t) && grpOf(t)) group = t;
          }
        }
        const plate = clean(c[M["شماره ماشین"]] || "");
        const kind = clean(c[M["نوع ماشین"]] || "");
        if (!plate || plate === "نوع ماشین") continue;
        if (!/\d/.test(digits(plate)) && !/یدک|لودر/.test(plate)) continue;
        const drv = clean(c[M["نام راننده"]] || "");
        const st = clean(c[M["آخرین وضعیت"]] || "");
        const isSpare = /^یدک$/.test(plate);
        const code = isSpare ? kind : digits(plate);
        if (!code || seen[code]) continue; seen[code] = 1;
        const type = typeOf(group || kind);
        out.machines.push({
          id: uid(), name: (isSpare ? "پمپ " + kind : kind + " " + code).trim(),
          type: type, status: statusOf(st, drv), code: code, model: kind, year: "",
          driver: /بدون راننده|از خط خارج/.test(drv) ? "" : drv,
          unit: type === "لودر" ? "ساعت" : "کیلومتر", usage: 0,
          insDue: "", inspDue: "", licDue: "",
          notes: [st, clean(c[M["شرح خرابی ماشین"]] || "")].filter(Boolean).join(" — ").slice(0, 300)
        });
      }
    }
    const names = {};
    for (const m of out.machines) {
      const d = clean(m.driver);
      if (!d || names[d]) continue; names[d] = 1;
      out.contacts.push({
        id: uid(), role: m.type === "لودر" ? "اپراتور / سایر" : "راننده",
        name: d, phone: "", machineId: m.id, hire: "", licDue: "", active: true, notes: ""
      });
    }
    return out;
  }

  /* ۲ — صورت تعمیرات روزانه تعمیرگاه */
  function parseWorkshop(sheets) {
    const out = [];
    for (const sh of sheets) {
      const h = header(sh.rows, ["شماره پلاک", "شرح عیب", "تاریخ", "شماره گزارش", "تعمیرکار", "وضعیت"], 8);
      if (!h) continue;
      const M = h.map;
      for (let i = h.i + 1; i < sh.rows.length; i++) {
        const c = sh.rows[i].c;
        const plate = clean(c[M["شماره پلاک"]] || "");
        const desc = clean(c[M["شرح عیب"]] || "");
        if (!plate || !desc) continue;
        const d = jdate(c[M["تاریخ"]] || "");
        out.push({
          plate: plate, date: d, desc: desc,
          rep: clean(c[M["تعمیرکار"]] || ""),
          st: clean(c[M["وضعیت"]] || ""),
          no: digits(c[M["شماره گزارش"]] || "")
        });
      }
    }
    return out;
  }

  const CAUSE = [
    [/باطری|چراغ|دینام|استارت|برق|پروژکتور|فیوز|سیم/, "برقی"],
    [/هیدرولیک|جک|پمپ روغن|شیلنگ فشار/, "هیدرولیک"],
    [/موتور|رادیاتور|واتر|سوپاپ|میلنگ|کمپرس|توربو/, "موتور"],
    [/لاستیک|پنچر|تایر/, "لاستیک"],
    [/تصادف|واژگون|صافکاری/, "تصادف"],
    [/گیربکس|دیفرانسیل|اکسل|ترمز|کلاچ|دیسک|جلوبندی|گاردان|یاتاقان|بلبرینگ|فنر/, "مکانیکی"]
  ];
  function causeOf(t) { for (const [re, v] of CAUSE) if (re.test(t)) return v; return "سایر"; }

  /* ۳ — تقسیم مقاطع پمپ */
  function parsePump(sheets) {
    const out = [];
    for (const sh of sheets) {
      if (/^Sheet\d*$/i.test(sh.name) || /رضایت/.test(sh.name)) continue;
      const h = header(sh.rows, ["تاریخ", "نام مشتری", "مقطع", "متراژ", "عیار", "پمپ ارسالی"], 6);
      if (!h) continue;
      const M = h.map;
      for (let i = h.i + 1; i < sh.rows.length; i++) {
        const c = sh.rows[i].c;
        const d = jdate(c[M["تاریخ"]] || "");
        const m3 = num(c[M["متراژ"]] || "");
        if (!d || !(m3 > 0)) continue;
        out.push({
          date: d, m3: m3,
          customer: clean(c[M["نام مشتری"]] || ""),
          addr: clean(c[M["آدرس"]] || ""),
          section: sectOf(c[M["مقطع"]] || ""),
          grade: clean(c[M["عیار"]] || ""),
          pump: clean(c[M["پمپ ارسالی"]] || ""),
          tSend: timeOf(c[M["ساعت ارسال پمپ"]] || ""),
          tStart: timeOf(c[M["ساعت شروع بار"]] || ""),
          tEnd: timeOf(c[M["ساعت اتمام بار"]] || ""),
          resp: clean(c[M["نام مسئول ترانسپورت"]] || ""),
          src: sh.name
        });
      }
    }
    return out;
  }

  /* ====================== ثبت ====================== */

  function machByPlate(p) {
    const k = normPlate(p);
    if (!k) return null;
    return S.machines.find(m => normPlate(m.code) === k)
      || S.machines.find(m => normPlate(m.name).indexOf(k) >= 0) || null;
  }

  async function commitFleet(d) {
    let nm = 0, nc = 0;
    for (const m of d.machines) {
      if (S.machines.some(x => normPlate(x.code) === normPlate(m.code))) continue;
      S.machines.push(m); nm++;
    }
    for (const c of d.contacts) {
      if (S.contacts.some(x => clean(x.name) === clean(c.name))) continue;
      const mm = S.machines.find(x => x.id === c.machineId);
      if (!mm) c.machineId = "";
      S.contacts.push(c); nc++;
    }
    if (nm) await persist("machines");
    if (nc) { await persist("contacts"); if (typeof pushWatch === "function") pushWatch(); }
    return nm + " دستگاه و " + nc + " نفر ثبت شد.";
  }

  async function commitWorkshop(rows) {
    let n = 0, skipNoMach = 0, dup = 0;
    for (const r of rows) {
      const m = machByPlate(r.plate);
      if (!m) { skipNoMach++; continue; }
      const title = r.desc.slice(0, 160);
      if (S.faults.some(f => f.machineId === m.id && f.date === r.date && clean(f.title) === clean(title))) { dup++; continue; }
      S.faults.push({
        id: uid(), machineId: m.id, title: title, date: r.date || todayISO(),
        cause: causeOf(r.desc), stopped: false, cost: 0,
        notes: [r.no ? "گزارش " + r.no : "", r.rep ? "تعمیرکار: " + r.rep : "", r.st, r.desc].filter(Boolean).join(" — "),
        photos: [], status: /ترخیص|انجام|رفع|تحویل/.test(r.st) ? "done" : "open"
      });
      n++;
    }
    if (n) await persist("faults");
    return n + " خرابی ثبت شد" + (dup ? "، " + dup + " تکراری رد شد" : "") +
      (skipNoMach ? "، " + skipNoMach + " سطر چون پلاکش در ماشین‌آلات نبود رد شد" : "") + ".";
  }

  async function commitPump(rows) {
    const key = x => [x.date, clean(x.customer), x.m3, x.tStart || "", clean(x.pump), x.section].join("|");
    const have = {}, want = {};
    for (const p of S.pumpjobs) { const k = key(p); have[k] = (have[k] || 0) + 1; }
    let n = 0, dup = 0;
    for (const r of rows) {
      const k = key(r);
      want[k] = (want[k] || 0) + 1;
      if (want[k] <= (have[k] || 0)) { dup++; continue; }   // همین تعداد از قبل هست
      S.pumpjobs.push(Object.assign({ id: uid() }, r));
      n++;
    }
    if (n) await persist("pumpjobs");
    return n + " رکورد پمپاژ ثبت شد" + (dup ? "، " + dup + " تکراری رد شد" : "") + ".";
  }

  /* ====================== نما ====================== */

  const KIND = {
    fleet: { t: "فهرست ماشین‌آلات و رانندگان", p: parseFleet, c: commitFleet, hint: "فایلی مثل 1405_08_18.xlsx — پایه‌ی همه‌چیز است، اول این." },
    ws: { t: "صورت تعمیرات روزانه تعمیرگاه", p: parseWorkshop, c: commitWorkshop, hint: "فایل‌های تعمیرگاه. اول باید ماشین‌آلات وارد شده باشد." },
    pump: { t: "تقسیم مقاطع پمپ", p: parsePump, c: commitPump, hint: "همه‌ی شیت‌های ماهانه با هم خوانده می‌شود." }
  };
  let pending = null, busy = false, msg = "";

  function previewHtml() {
    if (!pending) return "";
    const k = pending.kind, d = pending.data;
    let rows = "", count = 0;
    if (k === "fleet") {
      count = d.machines.length;
      rows = d.machines.slice(0, 10).map(m =>
        `<tr><td>${esc(m.code)}</td><td>${esc(m.type)}</td><td>${esc(m.driver || "—")}</td><td>${esc(m.status)}</td></tr>`).join("");
      rows = `<table><tr><th>پلاک</th><th>نوع</th><th>راننده</th><th>وضعیت</th></tr>${rows}</table>
        <div class="m">${fa(d.machines.length)} دستگاه و ${fa(d.contacts.length)} نفر.</div>`;
    } else if (k === "ws") {
      count = d.length;
      rows = d.slice(0, 10).map(x =>
        `<tr><td>${esc(x.plate)}</td><td>${x.date ? jal(x.date) : "—"}</td><td>${esc(x.desc.slice(0, 60))}</td></tr>`).join("");
      rows = `<table><tr><th>پلاک</th><th>تاریخ</th><th>شرح عیب</th></tr>${rows}</table>`;
    } else {
      count = d.length;
      const tot = d.reduce((a, x) => a + x.m3, 0), by = {};
      for (const x of d) by[x.section] = (by[x.section] || 0) + x.m3;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([s, v]) => `<tr><td>${esc(s)}</td><td>${fa(Math.round(v))}</td></tr>`).join("");
      rows = `<div class="m">مجموع ${fa(Math.round(tot))} متر مکعب در ${fa(d.length)} نوبت پمپاژ.</div>
        <table><tr><th>مقطع</th><th>متر مکعب</th></tr>${top}</table>`;
    }
    return `<div class="card"><h3>پیش‌نمایش — ${esc(KIND[k].t)}</h3>${rows}
      <div class="row" style="margin-top:9px">
        <button class="primary" id="impOk" ${count ? "" : "disabled"}>تأیید و ثبت</button>
        <button class="ghost" id="impNo">انصراف</button></div></div>`;
  }

  function vImport() {
    const cards = Object.keys(KIND).map(k =>
      `<div class="card"><h3>${esc(KIND[k].t)}</h3><div class="note">${esc(KIND[k].hint)}</div>
       <input type="file" id="f_${k}" accept=".xlsx" multiple style="margin-top:8px">
       <div class="row" style="margin-top:8px"><button class="ghost" data-imp="${k}">خواندن فایل</button></div></div>`).join("");
    const have = S.pumpjobs && S.pumpjobs.length
      ? `<div class="card"><h3>سابقه پمپاژ در اپ</h3><div class="m">${fa(S.pumpjobs.length)} نوبت، مجموع ${fa(Math.round(S.pumpjobs.reduce((a, x) => a + (+x.m3 || 0), 0)))} متر مکعب.</div></div>` : "";
    return `<div class="card"><h3>ورود از فایل اکسل</h3>
      <div class="note">فایل‌های گذشته را اینجا وارد کن تا از نو تایپ نشوند. ترتیب مهم است: اول ماشین‌آلات، بعد بقیه.</div>
      ${msg ? `<div class="m" style="margin-top:6px">${esc(msg)}</div>` : ""}
      <div class="note" id="impStat" style="margin-top:6px"></div></div>
      ${previewHtml()}${cards}${have}`;
  }

  /* ====================== اتصال به اپ ====================== */

  const _render = window.render;
  window.render = function () {
    if (typeof tab === "undefined" || tab !== "imp") return _render();
    document.getElementById("todayLbl").textContent = jal(todayISO());
    document.getElementById("nav").innerHTML = TABS.map(([k, n]) =>
      `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${n}</button>`).join("");
    document.getElementById("main").innerHTML = vImport();
  };

  function stat(t) { const e = document.getElementById("impStat"); if (e) e.textContent = t; }

  document.addEventListener("click", async function (e) {
    const b = e.target.closest && e.target.closest("button"); if (!b) return;
    if (b.dataset.imp) {
      const k = b.dataset.imp, inp = document.getElementById("f_" + k);
      const files = [...((inp && inp.files) || [])];
      if (!files.length) return alert("اول فایل را انتخاب کن.");
      if (busy) return; busy = true; stat("در حال خواندن...");
      try {
        let sheets = [];
        for (const f of files) sheets = sheets.concat(await readXlsx(f));
        const data = KIND[k].p(sheets);
        const n = k === "fleet" ? data.machines.length : data.length;
        if (!n) { msg = "در این فایل سطر قابل استفاده‌ای پیدا نشد. مطمئن شو فایل درست را به بخش درست داده‌ای."; pending = null; }
        else { pending = { kind: k, data: data }; msg = ""; }
      } catch (err) {
        msg = "خواندن فایل ناموفق بود: " + (err.message || err); pending = null;
      }
      busy = false; render(); window.scrollTo(0, 0); return;
    }
    if (b.id === "impNo") { pending = null; msg = ""; render(); return; }
    if (b.id === "impOk") {
      if (!pending || busy) return;
      busy = true; b.disabled = true; b.textContent = "در حال ثبت...";
      try { msg = await KIND[pending.kind].c(pending.data); pending = null; }
      catch (err) { msg = "ثبت ناموفق بود: " + (err.message || err); }
      busy = false; render(); return;
    }
  });

  async function boot() {
    for (let i = 0; i < 60; i++) {
      if (typeof S !== "undefined" && typeof COLS !== "undefined" && S[COLS[0]]) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (COLS.indexOf("pumpjobs") < 0) COLS.push("pumpjobs");
    if (!Array.isArray(S.pumpjobs)) {
      try { S.pumpjobs = (await DBS.get("pumpjobs")) || []; } catch (e) { S.pumpjobs = []; }
    }
    if (!TABS.some(t => t[0] === "imp")) TABS.push(["imp", "ورود از فایل"]);
    if (!("DecompressionStream" in window)) console.warn("import.js: این نسخه مرورگر xlsx را باز نمی‌کند.");
    render();
  }

  window.__sbImport = { read: readXlsx };
  boot();
})();
