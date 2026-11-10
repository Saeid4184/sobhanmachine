// سرور واسط اپ سبحان بتن: دستیار Claude + پشتیبان‌گیری
// نیاز: Node.js نسخه 18 یا بالاتر — بدون هیچ پکیج اضافه
const http = require("http");
const fs = require("fs");
const path = require("path");

const KEY = process.env.ANTHROPIC_API_KEY;
const TOKEN = process.env.APP_TOKEN;
const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 3000;
const BACKUP_DIR = process.env.BACKUP_DIR || "/var/lib/sobhan-ai/backups";
const KEEP = Number(process.env.BACKUP_KEEP) || 60;

if (!KEY || !TOKEN) {
  console.error("ANTHROPIC_API_KEY و APP_TOKEN باید تنظیم شوند.");
  process.exit(1);
}
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-app-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function send(res, code, obj) {
  res.writeHead(code, { ...cors, "Content-Type": "application/json; charset=utf-8" });
  res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
}
async function readBody(req, limit) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error("درخواست خیلی بزرگ است"), { code: 413 });
  }
  return body;
}
const backups = () => fs.readdirSync(BACKUP_DIR).filter(f => /^backup-\d{8}-\d{6}\.json$/.test(f)).sort();

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, "http://x");
  if (req.headers["x-app-token"] !== TOKEN) return send(res, 401, { error: "رمز اپ اشتباه است" });

  try {
    // --- دستیار Claude
    if (req.method === "POST" && url.pathname === "/ask") {
      let prompt;
      try { prompt = JSON.parse(await readBody(req, 600000)).prompt; } catch (e) { return send(res, e.code || 400, { error: e.code ? e.message : "bad json" }); }
      if (typeof prompt !== "string" || !prompt.trim()) return send(res, 400, { error: "prompt خالی است" });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: prompt }] }),
      });
      const j = await r.json();
      if (!r.ok) return send(res, r.status, { error: (j.error && j.error.message) || "API error" });
      return send(res, 200, { text: (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n") });
    }

    // --- ذخیره پشتیبان
    if (req.method === "POST" && url.pathname === "/backup") {
      const body = await readBody(req, 40 * 1024 * 1024);
      let j; try { j = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }); }
      if (j.app !== "sobhan-beton") return send(res, 400, { error: "فایل پشتیبان معتبر نیست" });
      const d = new Date(), p2 = n => String(n).padStart(2, "0");
      const name = `backup-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`;
      fs.writeFileSync(path.join(BACKUP_DIR, name), body);
      const all = backups(); all.slice(0, Math.max(0, all.length - KEEP)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
      return send(res, 200, { ok: true, name, size: body.length });
    }
    // --- فهرست و دریافت پشتیبان
    if (req.method === "GET" && url.pathname === "/backup/list") {
      return send(res, 200, { files: backups().reverse().map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size })) });
    }
    if (req.method === "GET" && url.pathname === "/backup/latest") {
      const all = backups(); if (!all.length) return send(res, 404, { error: "پشتیبانی روی سرور نیست" });
      return send(res, 200, fs.readFileSync(path.join(BACKUP_DIR, all[all.length - 1]), "utf8"));
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, e.code === 413 ? 413 : 502, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log("proxy listening on", PORT, "model:", MODEL, "backups:", BACKUP_DIR));
