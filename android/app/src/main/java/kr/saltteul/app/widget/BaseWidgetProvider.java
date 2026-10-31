package kr.saltteul.app.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;

/** Shared provider behaviour: draw from cache now, refresh in the background, keep the 04:01 alarm. */
public abstract class BaseWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "SaltteulWidget";

    protected abstract String kind();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        try {
            WidgetRenderer.render(context, manager, kind(), appWidgetIds);
            WidgetAlarmReceiver.schedule(context);
            RefreshJob.requestIfStale(context);
        } catch (Throwable e) {
            Log.w(TAG, "onUpdate failed", e);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        try {
            WidgetRenderer.render(context, manager, kind(), new int[] {appWidgetId});
        } catch (Throwable e) {
            Log.w(TAG, "options redraw failed", e);
        }
    }

    @Override
    public void onEnabled(Context context) {
        WidgetAlarmReceiver.schedule(context);
        RefreshJob.enqueue(context, false);
    }

    @Override
    public void onDisabled(Context context) {
        // Called per provider; keep the alarm while any of the widgets is still placed.
        if (!WidgetRenderer.hasAnyWidget(context)) WidgetAlarmReceiver.cancel(context);
    }
}
