// پل بین کد مشترک www و ویندوز.
// هدف: کد داخل www دست‌نخورده بماند و همان فراخوانی‌های Capacitor اینجا هم کار کند.
const { ipcRenderer } = require("electron");

const ok = (v) => Promise.resolve(v);

// --- تبدیل زمان‌بندی Capacitor به لیست ساده‌ی {id, title, body, at} ---
const MS = { day: 86400000, hour: 3600000, minute: 60000, week: 604800000 };
const REPEAT_COUNT = 30; // برای یادآوری‌های تکرارشونده، ۳۰ نوبت آینده ثبت می‌شود

function expand(n) {
  const base = { id: Number(n.id) || Date.now() % 1e6, title: n.title, body: n.body };
  const s = n.schedule || {};
  let at = s.at ? new Date(s.at) : new Date();
  if (s.on && !s.at) {
    const d = new Date();
    if (s.on.hour != null) d.setHours(s.on.hour);
    if (s.on.minute != null) d.setMinutes(s.on.minute);
    d.setSeconds(0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    at = d;
  }
  const step = s.every ? MS[s.every] : null;
  if (!step || !(s.repeats !== false)) return [{ ...base, at: at.toISOString() }];
  const out = [];
  let t = at.getTime();
  while (t < Date.now()) t += step;
  for (let i = 0; i < REPEAT_COUNT; i++) {
    out.push({ ...base, id: base.id * 1000 + i, parent: base.id, at: new Date(t).toISOString() });
    t += step;
  }
  return out;
}

const LocalNotifications = {
  requestPermissions: () => ok({ display: "granted" }),
  checkPermissions: () => ok({ display: "granted" }),
  createChannel: () => ok(),
  deleteChannel: () => ok(),
  listChannels: () => ok({ channels: [] }),
  registerActionTypes: () => ok(),
  schedule: (opts) => {
    const list = [].concat(opts && opts.notifications ? opts.notifications : []).flatMap(expand);
    return ipcRenderer.invoke("notify-schedule", list).then(() => ({ notifications: list }));
  },
  cancel: (opts) => {
    const ids = [].concat(opts && opts.notifications ? opts.notifications : []).flatMap((n) => {
      const base = Number(n.id);
      const all = [base];
      for (let i = 0; i < REPEAT_COUNT; i++) all.push(base * 1000 + i);
      return all;
    });
    return ipcRenderer.invoke("notify-cancel", ids).then(() => undefined);
  },
  removeAllDeliveredNotifications: () => ok(),
  getDeliveredNotifications: () => ok({ notifications: [] }),
  getPending: () => ipcRenderer.invoke("notify-pending").then((n) => ({ notifications: n })),
  addListener: (event, cb) => {
    if (event && event.indexOf("Action") > -1) {
      ipcRenderer.on("notification-click", (_e, n) => cb({ notification: n }));
    }
    return { remove: () => {} };
  },
  removeAllListeners: () => ok(),
};

// افزونه‌هایی که روی ویندوز معنا ندارند (مثل خواندن پیامک) به‌جای خطا، خالی برمی‌گردند
const stub = new Proxy(
  {},
  { get: () => () => ok({}) }
);

const Plugins = new Proxy(
  { LocalNotifications },
  {
    get: (t, k) => (k in t ? t[k] : stub),
    has: () => true,
  }
);

window.Capacitor = {
  Plugins,
  isNativePlatform: () => true,
  isPluginAvailable: (name) => name === "LocalNotifications",
  getPlatform: () => "windows",
  convertFileSrc: (u) => u,
};
window.CapacitorPlugins = Plugins;

// پرچم‌ها برای قابلیت‌هایی که بعداً اضافه می‌شوند
window.PLATFORM = "windows";
window.IS_DESKTOP = true;
window.HAS_SMS = false;
window.HAS_CAMERA = false;

// دسترسی به فایل برای پشتیبان‌گیری با پنجره‌ی ویندوز
window.SobhanDesktop = {
  saveFile: (name, text) => ipcRenderer.invoke("save-file", { name, text }),
  openFile: () => ipcRenderer.invoke("open-file"),
};
