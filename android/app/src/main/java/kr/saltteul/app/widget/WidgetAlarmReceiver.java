package kr.saltteul.app.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Daily inexact alarm at about 04:01 KST, when the household day changes: redraws the widgets so
 * routines show unchecked, refreshes, and schedules the next day. Also re-arms after reboot/update.
 */
public class WidgetAlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "SaltteulWidget";
    public static final String ACTION_ROLLOVER = "kr.saltteul.app.widget.DAY_ROLLOVER";
    private static final int REQUEST_CODE = 401;

    @Override
    public void onReceive(Context context, Intent intent) {
        Context c = context.getApplicationContext();
        String action = intent == null ? null : intent.getAction();
        if (!WidgetRenderer.hasAnyWidget(c)) {
            cancel(c);
            return;
        }
        if (ACTION_ROLLOVER.equals(action)) {
            WidgetRenderer.renderAll(c);
            RefreshJob.enqueue(c, true);
            schedule(c);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            schedule(c);
            WidgetRenderer.renderAll(c);
            RefreshJob.requestIfStale(c);
        }
    }

    private static PendingIntent pendingIntent(Context c) {
        Intent i = new Intent(c, WidgetAlarmReceiver.class);
        i.setAction(ACTION_ROLLOVER);
        return PendingIntent.getBroadcast(c, REQUEST_CODE, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Idempotent: the same PendingIntent replaces any earlier alarm. */
    public static void schedule(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long at = WidgetLogic.nextRolloverMillis(System.currentTimeMillis());
            // Inexact on purpose: no exact-alarm permission needed, a few minutes late is fine.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent(c));
        } catch (Throwable e) {
            Log.w(TAG, "could not schedule the 04:01 refresh", e);
        }
    }

    public static void cancel(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pendingIntent(c));
        } catch (Throwable e) {
            Log.w(TAG, "could not cancel the 04:01 refresh", e);
        }
    }
}
