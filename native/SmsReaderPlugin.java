package ir.sobhanbeton.app;

import android.Manifest;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * افزونه خواندن پیامک برای دستیار سبحان بتن.
 * فقط پیامک شماره‌هایی خوانده می‌شود که در فهرست پایش ثبت شده‌اند.
 *
 * متدهایی که اپ صدا می‌زند:
 *   checkPermissions()  -> { sms: "granted" | "denied" | "prompt" }   (از خود Capacitor)
 *   requestPermissions()
 *   readInbox({ since })        -> { messages: [{ id, date, phone, body }] }
 *   setWatchList({ drivers:[{phone,name}], notify })
 * رویداد: smsReceived
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS })
    }
)
public class SmsReaderPlugin extends Plugin {

    public static SmsReaderPlugin instance;
    public static final String PREFS = "sb_sms";
    public static final String K_LIST = "watch";
    public static final String K_NOTIFY = "notify";
    private static final int MAX_ROWS = 800;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** ده رقم آخر شماره، بدون صفر و کد کشور */
    public static String norm(String raw) {
        if (raw == null) return "";
        StringBuilder d = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c >= '0' && c <= '9') d.append(c);
            else if (c >= '\u06F0' && c <= '\u06F9') d.append((char) ('0' + (c - '\u06F0')));
            else if (c >= '\u0660' && c <= '\u0669') d.append((char) ('0' + (c - '\u0660')));
        }
        String s = d.toString();
        return s.length() > 10 ? s.substring(s.length() - 10) : s;
    }

    public static List<String> watchList(android.content.Context ctx) {
        List<String> out = new ArrayList<>();
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, 0);
            JSONArray a = new JSONArray(p.getString(K_LIST, "[]"));
            for (int i = 0; i < a.length(); i++) {
                String n = norm(a.getString(i));
                if (n.length() >= 7) out.add(n);
            }
        } catch (Exception e) { /* فهرست خالی */ }
        return out;
    }

    public static boolean notifyOn(android.content.Context ctx) {
        return ctx.getSharedPreferences(PREFS, 0).getBoolean(K_NOTIFY, true);
    }

    @PluginMethod
    public void setWatchList(PluginCall call) {
        JSArray drivers = call.getArray("drivers");
        JSONArray phones = new JSONArray();
        if (drivers != null) {
            for (int i = 0; i < drivers.length(); i++) {
                try {
                    Object o = drivers.get(i);
                    String ph = (o instanceof JSONObject) ? ((JSONObject) o).optString("phone", "") : String.valueOf(o);
                    String n = norm(ph);
                    if (n.length() >= 7) phones.put(n);
                } catch (Exception e) { /* رد شو */ }
            }
        }
        getContext().getSharedPreferences(PREFS, 0).edit()
            .putString(K_LIST, phones.toString())
            .putBoolean(K_NOTIFY, call.getBoolean("notify", Boolean.TRUE))
            .apply();
        JSObject r = new JSObject();
        r.put("count", phones.length());
        call.resolve(r);
    }

    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("اجازه خواندن پیامک داده نشده است.");
            return;
        }
        long since = 0L;
        Long s = call.getLong("since");
        if (s != null) since = s;

        List<String> watch = watchList(getContext());
        JSArray out = new JSArray();
        if (watch.isEmpty()) {
            JSObject r = new JSObject();
            r.put("messages", out);
            call.resolve(r);
            return;
        }

        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                Uri.parse("content://sms/inbox"),
                new String[]{ "_id", "address", "body", "date" },
                "date > ?",
                new String[]{ String.valueOf(since) },
                "date DESC LIMIT " + MAX_ROWS
            );
            if (c != null) {
                int iId = c.getColumnIndex("_id"), iAd = c.getColumnIndex("address");
                int iBd = c.getColumnIndex("body"), iDt = c.getColumnIndex("date");
                while (c.moveToNext()) {
                    String addr = iAd >= 0 ? c.getString(iAd) : "";
                    if (!watch.contains(norm(addr))) continue;
                    JSObject m = new JSObject();
                    m.put("id", iId >= 0 ? c.getString(iId) : "");
                    m.put("phone", addr == null ? "" : addr);
                    m.put("address", addr == null ? "" : addr);
                    m.put("body", iBd >= 0 ? c.getString(iBd) : "");
                    m.put("date", iDt >= 0 ? c.getLong(iDt) : 0L);
                    out.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("خواندن صندوق پیام ناموفق بود: " + e.getMessage());
            return;
        } finally {
            if (c != null) try { c.close(); } catch (Exception e) { }
        }

        JSObject r = new JSObject();
        r.put("messages", out);
        call.resolve(r);
    }

    /** از گیرنده‌ی پیامک صدا زده می‌شود تا اپ باز فوراً خبردار شود. */
    public void fireReceived(String phone) {
        JSObject d = new JSObject();
        d.put("phone", phone == null ? "" : phone);
        notifyListeners("smsReceived", d);
    }
}
