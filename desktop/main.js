// نسخه ویندوز «دستیار سبحان بتن»
// همان کدهای پوشه www را اجرا می‌کند؛ هیچ کد جداگانه‌ای برای رابط کاربری ندارد.
const { app, BrowserWindow, shell, Notification, ipcMain, dialog } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 41837; // ثابت می‌ماند تا مبدأ (origin) عوض نشود و داده‌ها باقی بماند
const WWW = path.join(__dirname, "www");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel === "/" || rel === "") rel = "/index.html";
      const file = path.normalize(path.join(WWW, rel));
      if (!file.startsWith(WWW)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("یافت نشد");
          return;
        }
        res.writeHead(200, {
          "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      });
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

// ---------- یادآوری‌ها (معادل LocalNotifications اندروید) ----------
const timers = new Map();

function fire(n) {
  timers.delete(n.id);
  if (!Notification.isSupported()) return;
  const note = new Notification({
    title: n.title || "دستیار سبحان بتن",
    body: n.body || "",
    icon: path.join(__dirname, "build", "icon.png"),
  });
  note.on("click", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      w.webContents.send("notification-click", n);
    }
  });
  note.show();
}

function schedule(n) {
  cancel(n.id);
  const at = n.at ? new Date(n.at).getTime() : Date.now();
  const delay = at - Date.now();
  if (delay <= 0) {
    fire(n);
    return;
  }
  // setTimeout در ویندوز تا حدود ۲۴ روز مطمئن است؛ برای دورترها تکه‌تکه می‌کنیم
  const step = Math.min(delay, 2000000000);
  const t = setTimeout(() => (delay > step ? schedule(n) : fire(n)), step);
  timers.set(n.id, t);
}

function cancel(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

ipcMain.handle("notify-schedule", (_e, list) => {
  (list || []).forEach(schedule);
  return true;
});
ipcMain.handle("notify-cancel", (_e, ids) => {
  (ids || []).forEach(cancel);
  return true;
});
ipcMain.handle("notify-pending", () => [...timers.keys()].map((id) => ({ id })));

// ---------- ذخیره و بازخوانی فایل پشتیبان ----------
ipcMain.handle("save-file", async (_e, { name, text }) => {
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: name });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, text, "utf8");
  return filePath;
});
ipcMain.handle("open-file", async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (canceled || !filePaths[0]) return null;
  return fs.readFileSync(filePaths[0], "utf8");
});

// ---------- پنجره ----------
const stateFile = () => path.join(app.getPath("userData"), "window.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1180, height: 820 };
  }
}

function createWindow() {
  const s = readState();
  const win = new BrowserWindow({
    width: s.width,
    height: s.height,
    x: s.x,
    y: s.y,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#0d1117",
    title: "دستیار سبحان بتن",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (s.maximized) win.maximize();
  win.loadURL(`http://127.0.0.1:${PORT}/index.html`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const save = () => {
    const b = win.getNormalBounds();
    try {
      fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch {}
  };
  win.on("close", save);

  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.setAppUserModelId("ir.sobhanbeton.assistant");
  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (e) {
      dialog.showErrorBox("خطا", "اجرای سرور داخلی ممکن نشد: " + e.message);
      app.quit();
      return;
    }
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => app.quit());
}
