package ir.sobhanbeton.assistant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.util.Map;

/** وقتی اپ بسته است، برای پیامک از شماره رانندگان اعلان نشان می‌دهد */
public class SmsNotifyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            if (!ctx.getSharedPreferences(SmsReaderPlugin.PREFS, Context.MODE_PRIVATE).getBoolean("notify", true)) return;
            Map<String, String> w = SmsReaderPlugin.watched(ctx);
            if (w.isEmpty()) return;
            SmsMessage[] msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (msgs == null || msgs.length == 0) return;
            String k = SmsReaderPlugin.norm(msgs[0].getOriginatingAddress());
            if (!w.containsKey(k)) return;
            StringBuilder body = new StringBuilder();
            for (SmsMessage m : msgs) body.append(m.getMessageBody());
            String name = w.get(k);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel("driver_sms", "پیام رانندگان", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getActivity(ctx, 7001, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, "driver_sms") : new Notification.Builder(ctx);
            b.setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle("گزارش جدید" + (name == null || name.isEmpty() ? "" : ": " + name))
                .setContentText(body.toString())
                .setStyle(new Notification.BigTextStyle().bigText(body.toString()))
                .setAutoCancel(true)
                .setContentIntent(pi);
            nm.notify((int) (System.currentTimeMillis() % 1000000), b.build());
        } catch (Exception e) { }
    }
}
