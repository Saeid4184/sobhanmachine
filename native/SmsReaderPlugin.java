package ir.sobhanbeton.assistant;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "SmsReader",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }) }
)
public class SmsReaderPlugin extends Plugin {

    static final String PREFS = "sb_sms";
    private BroadcastReceiver liveReceiver;

    /** آخرین ۱۰ رقم شماره (ارقام فارسی هم پشتیبانی می‌شود) */
    static String norm(String n) {
        if (n == null) return "";
        StringBuilder d = new StringBuilder();
        for (char c : n.toCharArray()) {
            if (Character.isDigit(c)) d.append(Character.getNumericValue(c));
        }
        String s = d.toString();
        return s.length() > 10 ? s.substring(s.length() - 10) : s;
    }

    /** شماره‌های پایش‌شده: شماره نرمال‌شده ← نام راننده */
    static Map<String, String> watched(Context ctx) {
        Map<String, String> out = new HashMap<>();
        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("drivers", "[]");
        try {
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String k = norm(o.optString("phone", ""));
                if (k.length() >= 7) out.put(k, o.optString("name", ""));
            }
        } catch (Exception e) { }
        return out;
    }

    @Override
    public void load() {
        liveReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                notifyListeners("smsReceived", new JSObject());
            }
        };
        IntentFilter f = new IntentFilter("android.provider.Telephony.SMS_RECEIVED");
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                getContext().registerReceiver(liveReceiver, f, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(liveReceiver, f);
            }
        } catch (Exception e) { }
    }

    @Override
    protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(liveReceiver); } catch (Exception e) { }
    }

    @PluginMethod
    public void setWatchList(PluginCall call) {
        JSArray drivers = call.getArray("drivers");
        Boolean notify = call.getBoolean("notify", true);
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("drivers", drivers == null ? "[]" : drivers.toString())
            .putBoolean("notify", notify == null || notify)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted");
            return;
        }
        Long sinceObj = call.getLong("since", 0L);
        long since = sinceObj == null ? 0L : sinceObj;
        Map<String, String> nums = watched(getContext());
        JSArray out = new JSArray();
        if (!nums.isEmpty()) {
            Cursor c = null;
            try {
                c = getContext().getContentResolver().query(
                    Uri.parse("content://sms/inbox"),
                    new String[] { "_id", "address", "body", "date" },
                    "date > ?",
                    new String[] { String.valueOf(since) },
                    "date ASC"
                );
                if (c != null) {
                    while (c.moveToNext()) {
                        String addr = c.getString(1);
                        String k = norm(addr);
                        if (!nums.containsKey(k)) continue;
                        JSObject o = new JSObject();
                        o.put("id", c.getString(0));
                        o.put("address", addr);
                        o.put("phone", k);
                        o.put("body", c.getString(2));
                        o.put("date", c.getLong(3));
                        out.put(o);
                    }
                }
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
                return;
            } finally {
                if (c != null) c.close();
            }
        }
        JSObject r = new JSObject();
        r.put("messages", out);
        call.resolve(r);
    }
}
