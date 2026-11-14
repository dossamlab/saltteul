package kr.saltteul.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import kr.saltteul.app.R;

/**
 * RemoteViews for the month calendar, weather + 챙길 것 and quick-add widgets (design 2026-11-14). The decisions are
 * in CalendarLogic, CalendarPainter and EssentialsLogic; this class only binds them to views.
 */
final class CalendarSetRenderer {

    private static final String TAG = "SaltteulWidget";

    /** Space around the calendar bitmap in widget_calendar.xml (dp): root padding, card padding and the header. */
    static final int CAL_PAD_W = 3 * 2 + 10 * 2;
    static final int CAL_PAD_H = 3 * 2 + 6 + 8 + 36;
    /** Used until the launcher reports the widget size (a 4x4 phone widget). */
    static final int DEFAULT_W_DP = 320;
    static final int DEFAULT_H_DP = 340;

    private CalendarSetRenderer() {}

    // ---------- month calendar 4x4 ----------

    static RemoteViews calendar(Context c, AppWidgetManager m, int widgetId) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_calendar);
        v.setOnClickPendingIntent(R.id.widget_message, WidgetRenderer.openApp(c));
        Snapshot s = ready(c, v);
        if (s == null) return v;

        PendingIntent month = WidgetRenderer.openTarget(c, OpenTargets.TODOS_MONTH);
        v.setOnClickPendingIntent(R.id.widget_header, month);
        v.setOnClickPendingIntent(R.id.cal_image, month);
        v.setOnClickPendingIntent(R.id.cal_add, WidgetRenderer.openTarget(c, OpenTargets.CAPTURE));

        String today = WidgetLogic.householdDate(System.currentTimeMillis());
        CalendarLogic.Month mo = CalendarLogic.monthOf(today);
        v.setTextViewText(R.id.cal_month, CalendarLogic.monthLabel(mo));

        int[] size = sizeDp(c, m, widgetId);
        int w = Math.max(120, size[0] - CAL_PAD_W);
        int h = Math.max(120, size[1] - CAL_PAD_H);
        try {
            Bitmap bmp = CalendarBitmap.draw(w, h, c.getResources().getDisplayMetrics().density, mo, s, today,
                    weekdayNames(c));
            v.setImageViewBitmap(R.id.cal_image, bmp);
        } catch (Throwable e) {
            // Out of memory or a drawing error: keep the header and the + button working.
            Log.w(TAG, "calendar bitmap failed", e);
        }
        return v;
    }

    /** Widget size in dp: min width x max height in portrait, max width x min height in landscape. */
    static int[] sizeDp(Context c, AppWidgetManager m, int id) {
        Bundle o = m.getAppWidgetOptions(id);
        int w = 0;
        int h = 0;
        if (o != null) {
            boolean landscape = c.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
            w = o.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            h = o.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        }
        return new int[] {w > 0 ? w : DEFAULT_W_DP, h > 0 ? h : DEFAULT_H_DP};
    }

    static String[] weekdayNames(Context c) {
        String[] out = new String[7];
        for (int i = 0; i < 7; i++) out[i] = WidgetRenderer.weekdayName(c, i);
        return out;
    }

    // ---------- weather + 챙길 것 4x1 ----------

    static RemoteViews essentials(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_essentials);
        v.setOnClickPendingIntent(R.id.widget_message, WidgetRenderer.openApp(c));
        Snapshot s = ready(c, v);
        if (s == null) return v;
        long now = System.currentTimeMillis();
        String day = WidgetLogic.householdDate(now);

        Snapshot.Weather w = WidgetLogic.weatherFor(s, WidgetLogic.seoulDate(now));
        String temps = EssentialsLogic.highLow(w);
        boolean rain = w != null && w.popMax != null;
        boolean weather = temps != null || rain;
        v.setViewVisibility(R.id.ess_weather, weather ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.ess_divider, weather ? View.VISIBLE : View.GONE);
        if (weather) {
            v.setImageViewResource(R.id.ess_sky, skyDrawable(EssentialsLogic.skyIcon(w.sky)));
            v.setTextViewText(R.id.ess_temp, temps == null ? "" : temps);
            v.setViewVisibility(R.id.ess_temp, temps == null ? View.GONE : View.VISIBLE);
            if (rain) v.setTextViewText(R.id.ess_rain, c.getString(R.string.widget_essentials_rain,
                    String.valueOf(Math.round(w.popMax))));
            v.setViewVisibility(R.id.ess_rain, rain ? View.VISIBLE : View.GONE);
        }

        EssentialsLogic.Essential e = EssentialsLogic.choose(s, day);
        v.setTextViewText(R.id.ess_line, lineText(c, e));
        v.setOnClickPendingIntent(R.id.widget_content, WidgetRenderer.openTarget(c, e.target()));
        return v;
    }

    static String lineText(Context c, EssentialsLogic.Essential e) {
        if (EssentialsLogic.KIND_PREP.equals(e.kind)) {
            return c.getString(R.string.widget_essentials_prep, EssentialsLogic.namesText(e.names, false));
        }
        if (EssentialsLogic.KIND_TRIP.equals(e.kind)) {
            String name = e.trip.name == null ? "" : e.trip.name.trim();
            String when = e.when != null ? e.when : c.getString(R.string.widget_essentials_tripOngoing);
            return c.getString(R.string.widget_essentials_trip, name, when, String.valueOf(e.trip.packed),
                    String.valueOf(e.trip.total)).trim();
        }
        if (EssentialsLogic.KIND_SHOPPING.equals(e.kind)) {
            return c.getString(R.string.widget_essentials_shopping, String.valueOf(e.count),
                    EssentialsLogic.namesText(e.names, e.more));
        }
        return c.getString(R.string.widget_essentials_empty);
    }

    private static int skyDrawable(String icon) {
        if (EssentialsLogic.ICON_CLEAR.equals(icon)) return R.drawable.widget_sky_clear;
        if (EssentialsLogic.ICON_CLOUDY.equals(icon)) return R.drawable.widget_sky_cloudy;
        if (EssentialsLogic.ICON_RAIN.equals(icon)) return R.drawable.widget_sky_rain;
        if (EssentialsLogic.ICON_SNOW.equals(icon)) return R.drawable.widget_sky_snow;
        return R.drawable.widget_sky_partly;
    }

    // ---------- quick-add bar 4x1 ----------

    /** Needs no data: the bar opens quick add, the mic opens it recording (design 3.1). */
    static RemoteViews quickAdd(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd);
        v.setOnClickPendingIntent(R.id.quick_bar, WidgetRenderer.openTarget(c, OpenTargets.CAPTURE));
        v.setOnClickPendingIntent(R.id.quick_mic, WidgetRenderer.openTarget(c, OpenTargets.CAPTURE_MIC));
        return v;
    }

    // ---------- shared ----------

    /** Same states as the other widgets: sign-in message, loading, or the content (returns the snapshot then). */
    private static Snapshot ready(Context c, RemoteViews v) {
        Snapshot s = WidgetRepository.loadCache(c);
        String uid = WidgetRepository.currentUid(c);
        if (uid == null || (s != null && !Snapshot.STATUS_OK.equals(s.status))) {
            WidgetRenderer.showMessage(c, v, R.string.widget_signIn);
            return null;
        }
        if (s == null) {
            WidgetRenderer.showMessage(c, v, R.string.widget_loading);
            return null;
        }
        v.setViewVisibility(R.id.widget_message, View.GONE);
        v.setViewVisibility(R.id.widget_content, View.VISIBLE);
        return s;
    }
}
