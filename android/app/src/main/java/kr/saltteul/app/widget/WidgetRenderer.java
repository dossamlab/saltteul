package kr.saltteul.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Map;
import kr.saltteul.app.MainActivity;
import kr.saltteul.app.R;

/** Builds the RemoteViews for the widgets from the cached snapshot. */
public final class WidgetRenderer {

    private static final String TAG = "SaltteulWidget";

    static final Class<?>[] PROVIDERS = {DashboardWidget.class, TodoWidget.class, TabletWidget.class};

    /** The tablet board splits into two columns from this width (dp). */
    static final float TWO_COLUMN_MIN_DP = 400f;

    private WidgetRenderer() {}

    static String kindOf(Class<?> provider) {
        if (provider == TodoWidget.class) return WidgetLogic.KIND_TODO;
        if (provider == TabletWidget.class) return WidgetLogic.KIND_TABLET;
        return WidgetLogic.KIND_DASHBOARD;
    }

    /** Redraws every placed widget and asks their lists to reload. Safe to call from any thread. */
    public static void renderAll(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            if (m == null) return;
            for (Class<?> p : PROVIDERS) {
                int[] ids = m.getAppWidgetIds(new ComponentName(c, p));
                if (ids == null || ids.length == 0) continue;
                render(c, m, kindOf(p), ids);
            }
        } catch (Throwable e) {
            Log.w(TAG, "renderAll failed", e);
        }
    }

    static boolean hasAnyWidget(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            if (m == null) return false;
            for (Class<?> p : PROVIDERS) {
                int[] ids = m.getAppWidgetIds(new ComponentName(c, p));
                if (ids != null && ids.length > 0) return true;
            }
        } catch (Throwable ignored) {
            // fall through
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    static void render(Context c, AppWidgetManager m, String kind, int[] ids) {
        for (int id : ids) {
            try {
                m.updateAppWidget(id, views(c, m, kind, id));
            } catch (Throwable e) {
                Log.w(TAG, "render failed for " + kind, e);
            }
        }
        // notifyAppWidgetViewDataChanged is deprecated on API 35 but is the only way on API 24-34.
        m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        if (WidgetLogic.KIND_TABLET.equals(kind)) m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_right);
    }

    /**
     * The tablet board as one column when narrow and two when wide. On API 31+ the launcher picks the layout for the
     * current size itself (so turning the tablet switches it); older versions decide from the size it reports now.
     */
    static RemoteViews views(Context c, AppWidgetManager m, String kind, int id) {
        if (!WidgetLogic.KIND_TABLET.equals(kind)) return build(c, kind, id, false);
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> bySize = new ArrayMap<>();
            bySize.put(new SizeF(180f, 180f), build(c, kind, id, false));
            bySize.put(new SizeF(TWO_COLUMN_MIN_DP, 180f), build(c, kind, id, true));
            return new RemoteViews(bySize);
        }
        return build(c, kind, id, widthDp(c, m, id) >= TWO_COLUMN_MIN_DP);
    }

    /** Current widget width: the max width in landscape, the min width in portrait (AppWidgetManager options). */
    private static int widthDp(Context c, AppWidgetManager m, int id) {
        Bundle o = m.getAppWidgetOptions(id);
        if (o == null) return 0;
        boolean landscape = c.getResources().getConfiguration().orientation
                == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        return o.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
    }

    private static int layoutFor(String kind) {
        if (WidgetLogic.KIND_TODO.equals(kind)) return R.layout.widget_todo;
        if (WidgetLogic.KIND_TABLET.equals(kind)) return R.layout.widget_tablet;
        return R.layout.widget_dashboard;
    }

    @SuppressWarnings("deprecation")
    static RemoteViews build(Context c, String kind, int widgetId, boolean twoColumns) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layoutFor(kind));
        PendingIntent open = openApp(c);
        v.setOnClickPendingIntent(R.id.widget_header, open);
        v.setOnClickPendingIntent(R.id.widget_message, open);

        Snapshot s = WidgetRepository.loadCache(c);
        String uid = WidgetRepository.currentUid(c);
        long now = System.currentTimeMillis();
        String day = WidgetLogic.householdDate(now);

        if (uid == null || (s != null && !Snapshot.STATUS_OK.equals(s.status))) {
            showMessage(c, v, R.string.widget_signIn);
            return v;
        }
        if (s == null) {
            showMessage(c, v, R.string.widget_loading);
            return v;
        }
        v.setViewVisibility(R.id.widget_message, View.GONE);
        v.setViewVisibility(R.id.widget_content, View.VISIBLE);

        if (WidgetLogic.KIND_TODO.equals(kind)) {
            v.setTextViewText(R.id.widget_title, c.getString(R.string.widget_todayTitle));
            int left = WidgetLogic.todoWidgetLeft(s, day);
            v.setTextViewText(R.id.widget_count, c.getString(R.string.widget_leftCount, String.valueOf(left)));
        } else {
            fillHeader(c, v, s, day, now);
            if (WidgetLogic.KIND_DASHBOARD.equals(kind)) {
                int shopping = WidgetLogic.openShopping(s).size();
                v.setTextViewText(R.id.widget_footer_title, c.getString(R.string.widget_shoppingTitle));
                v.setTextViewText(R.id.widget_footer_count,
                        c.getString(R.string.widget_leftCount, String.valueOf(shopping)));
                v.setOnClickPendingIntent(R.id.widget_footer, open);
            } else {
                v.setTextViewText(R.id.widget_updated,
                        c.getString(R.string.widget_updatedAt, WidgetLogic.seoulTime(s.fetchedAt)));
            }
        }

        boolean tablet = WidgetLogic.KIND_TABLET.equals(kind);
        String left = !tablet ? null : twoColumns ? WidgetLogic.COLUMN_LEFT : WidgetLogic.COLUMN_ALL;
        bindList(c, v, R.id.widget_list, R.id.widget_empty, kind, left, widgetId);
        if (tablet) {
            v.setViewVisibility(R.id.widget_col_divider, twoColumns ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_col_right, twoColumns ? View.VISIBLE : View.GONE);
            if (twoColumns) bindList(c, v, R.id.widget_list_right, R.id.widget_empty_right, kind, WidgetLogic.COLUMN_RIGHT, widgetId);
        }
        return v;
    }

    @SuppressWarnings("deprecation")
    private static void bindList(Context c, RemoteViews v, int listId, int emptyId, String kind, String column, int widgetId) {
        Intent svc = new Intent(c, WidgetListService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.putExtra(WidgetListService.EXTRA_KIND, kind);
        if (column != null) svc.putExtra(WidgetListService.EXTRA_COLUMN, column);
        // Unique data so each widget instance (and each column) gets its own factory.
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(listId, svc);
        v.setEmptyView(listId, emptyId);
        v.setPendingIntentTemplate(listId, toggleTemplate(c));
    }

    private static void showMessage(Context c, RemoteViews v, int textRes) {
        v.setViewVisibility(R.id.widget_content, View.GONE);
        v.setViewVisibility(R.id.widget_message, View.VISIBLE);
        v.setTextViewText(R.id.widget_message, c.getString(textRes));
    }

    private static void fillHeader(Context c, RemoteViews v, Snapshot s, String day, long now) {
        v.setTextViewText(R.id.widget_date, dateLabel(c, day));

        String weather = WidgetLogic.weatherLabel(WidgetLogic.weatherFor(s, WidgetLogic.seoulDate(now)));
        v.setTextViewText(R.id.widget_weather, weather);
        v.setViewVisibility(R.id.widget_weather, weather.isEmpty() ? View.GONE : View.VISIBLE);

        WidgetLogic.Upcoming ann = WidgetLogic.nearestAnniversary(s.anniversaries, day);
        if (ann != null) {
            String title = ann.title == null ? "" : ann.title + " ";
            v.setTextViewText(R.id.widget_dday, title + WidgetLogic.dDayLabel(ann.daysLeft));
            v.setViewVisibility(R.id.widget_dday, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.widget_dday, View.GONE);
        }

        boolean hasHeadline = s.headline != null && !s.headline.trim().isEmpty();
        v.setTextViewText(R.id.widget_briefing, hasHeadline ? s.headline.trim() : "");
        v.setViewVisibility(R.id.widget_briefing, hasHeadline ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.widget_meta, ann != null || hasHeadline ? View.VISIBLE : View.GONE);
    }

    /** "10월 28일 (수)" from the copy template date_md and weekday_N strings. */
    static String dateLabel(Context c, String ymd) {
        int[] p = WidgetLogic.parseYmd(ymd);
        return WidgetLogic.fill(c.getString(R.string.date_md),
                "m", String.valueOf(p[1]), "d", String.valueOf(p[2]), "w", weekdayName(c, WidgetLogic.weekdayOf(ymd)));
    }

    /** Today / tomorrow words, else the month-day label. */
    static String relativeDayLabel(Context c, String ymd, String today) {
        int diff = WidgetLogic.diffDays(today, ymd);
        if (diff == 0) return c.getString(R.string.date_today);
        if (diff == 1) return c.getString(R.string.date_tomorrow);
        return dateLabel(c, ymd);
    }

    static String weekdayName(Context c, int wd) {
        switch (wd) {
            case 0: return c.getString(R.string.weekday_0);
            case 1: return c.getString(R.string.weekday_1);
            case 2: return c.getString(R.string.weekday_2);
            case 3: return c.getString(R.string.weekday_3);
            case 4: return c.getString(R.string.weekday_4);
            case 5: return c.getString(R.string.weekday_5);
            default: return c.getString(R.string.weekday_6);
        }
    }

    /** Owner as the member's display name when known (design 13-1), else the generic word. */
    static String ownerLabel(Context c, Snapshot s, String owner) {
        if (owner == null) return null;
        if ("both".equals(owner)) return c.getString(R.string.owner_both);
        String name = s == null ? null : s.memberNames.get(owner);
        if (name != null) return name;
        if ("husband".equals(owner)) return c.getString(R.string.owner_husband);
        if ("wife".equals(owner)) return c.getString(R.string.owner_wife);
        return null;
    }

    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.setAction(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent toggleTemplate(Context c) {
        Intent t = new Intent(c, ToggleReceiver.class);
        t.setAction(ToggleReceiver.ACTION_TOGGLE);
        // Fill-in intents need a mutable template on API 31+. The intent is explicit, so this is allowed.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(c, 1, t, flags);
    }
}
