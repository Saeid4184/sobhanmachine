package ir.sobhanbeton.app;

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

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * با رسیدن پیامک از یکی از شماره‌های ثبت‌شده:
 *  - اگر اپ باز است، رویداد smsReceived را می‌فرستد تا فوراً وارد شود.
 *  - اگر بسته است، یک اعلان نشان می‌دهد تا بدانی گزارشی آمده.
 * متن پیامک جایی ذخیره نمی‌شود؛ اپ خودش از صندوق پیام می‌خواند.
 */
public class SmsWatcher extends BroadcastReceiver {

    private static final String CH = "sb_driver_sms";
    private static int seq = 7100;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        SmsMessage[] msgs;
        try { msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent); }
        catch (Exception e) { return; }
        if (msgs == null || msgs.length == 0) return;

        List<String> watch = SmsReaderPlugin.watchList(ctx);
        if (watch.isEmpty()) return;

        // قطعه‌های یک پیام بلند را به‌هم می‌چسباند
        Map<String, StringBuilder> byFrom = new HashMap<>();
        for (SmsMessage m : msgs) {
            if (m == null) continue;
            String from = SmsReaderPlugin.norm(m.getOriginatingAddress());
            if (!watch.contains(from)) continue;
            StringBuilder b = byFrom.get(from);
            if (b == null) { b = new StringBuilder(); byFrom.put(from, b); }
            String t = m.getMessageBody();
            if (t != null) b.append(t);
        }
        if (byFrom.isEmpty()) return;

        for (Map.Entry<String, StringBuilder> e : byFrom.entrySet()) {
            if (SmsReaderPlugin.instance != null) {
                try { SmsReaderPlugin.instance.fireReceived(e.getKey()); } catch (Exception ex) { }
            }
            if (SmsReaderPlugin.notifyOn(ctx)) notify(ctx, e.getKey(), e.getValue().toString());
        }
    }

    private void notify(Context ctx, String from, String body) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CH, "گزارش رانندگان", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("پیامک گزارش از شماره‌های ثبت‌شده");
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, flags);

            String txt = body == null ? "" : (body.length() > 120 ? body.substring(0, 120) + "…" : body);
            Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(ctx, CH) : new Notification.Builder(ctx);
            b.setSmallIcon(android.R.drawable.stat_notify_chat)
             .setContentTitle("گزارش پیامکی از " + from)
             .setContentText(txt)
             .setStyle(new Notification.BigTextStyle().bigText(txt))
             .setAutoCancel(true)
             .setContentIntent(pi);
            nm.notify(seq++, b.build());
        } catch (Exception e) { /* اعلان مهم‌تر از پایداری اپ نیست */ }
    }
}
