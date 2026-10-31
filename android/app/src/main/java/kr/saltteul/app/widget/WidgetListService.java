package kr.saltteul.app.widget;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import kr.saltteul.app.R;

/** Supplies the checkbox (and pantry −1) rows of each widget's ListView. */
public class WidgetListService extends RemoteViewsService {

    public static final String EXTRA_KIND = "kr.saltteul.app.widget.KIND";

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        String kind = intent.getStringExtra(EXTRA_KIND);
        return new Factory(getApplicationContext(), kind == null ? WidgetLogic.KIND_DASHBOARD : kind);
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private final String kind;
        private List<WidgetLogic.Row> rows = new ArrayList<>();
        private Snapshot snap;
        private String day;

        Factory(Context c, String kind) {
            this.c = c;
            this.kind = kind;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            try {
                snap = WidgetRepository.loadCache(c);
                day = WidgetLogic.householdDate(System.currentTimeMillis());
                rows = WidgetRepository.currentUid(c) == null
                        ? new ArrayList<WidgetLogic.Row>()
                        : WidgetLogic.buildRows(snap, kind, day);
            } catch (Throwable e) {
                rows = new ArrayList<>();
            }
        }

        @Override
        public void onDestroy() {
            rows = new ArrayList<>();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= rows.size()) return null;
            WidgetLogic.Row r = rows.get(position);
            if (r.type == WidgetLogic.Row.SECTION) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_section);
                v.setTextViewText(R.id.row_section, c.getString(sectionTitle(r.key)));
                return v;
            }
            if (r.type == WidgetLogic.Row.NOTE) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_note);
                v.setTextViewText(R.id.row_note, c.getString(R.string.widget_allDone));
                return v;
            }
            if (WidgetLogic.TARGET_PANTRY.equals(r.target)) return pantryRow(r);
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_item);
            v.setTextViewText(R.id.row_title, r.title == null ? "" : r.title);
            v.setTextColor(R.id.row_title, ContextCompat.getColor(c, r.checked ? R.color.widget_ink_3 : R.color.widget_ink));
            v.setImageViewResource(R.id.row_check, r.checked ? R.drawable.widget_check_on : R.drawable.widget_check_off);
            String sub = subtitle(r);
            v.setTextViewText(R.id.row_sub, sub);
            v.setViewVisibility(R.id.row_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
            v.setContentDescription(R.id.row_check_area, r.title == null ? "" : r.title);

            Intent fill = new Intent();
            fill.putExtra(ToggleReceiver.EXTRA_TARGET, r.target);
            fill.putExtra(ToggleReceiver.EXTRA_ID, r.id);
            fill.putExtra(ToggleReceiver.EXTRA_CHECKED, r.checked);
            if (r.consumableId != null) fill.putExtra(ToggleReceiver.EXTRA_CONSUMABLE, r.consumableId);
            if (r.pantryId != null) fill.putExtra(ToggleReceiver.EXTRA_PANTRY, r.pantryId);
            v.setOnClickFillInIntent(R.id.row_check_area, fill);
            return v;
        }

        /** Name, count, low marker, expiry badge and the −1 button (no tap target at zero). */
        private RemoteViews pantryRow(WidgetLogic.Row r) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_pantry);
            String name = r.title == null ? "" : r.title;
            v.setTextViewText(R.id.row_title, name);
            v.setTextViewText(R.id.row_qty, c.getString(R.string.widget_pantryQty, String.valueOf(r.qty), r.unit));
            v.setTextColor(R.id.row_qty, ContextCompat.getColor(c, r.low ? R.color.widget_terra : R.color.widget_ink_2));
            v.setViewVisibility(R.id.row_low, r.low ? View.VISIBLE : View.GONE);
            if (r.expired) {
                v.setTextViewText(R.id.row_expiry, c.getString(R.string.widget_pantryExpired));
                v.setViewVisibility(R.id.row_expiry, View.VISIBLE);
            } else if (r.expiryDays != null) {
                v.setTextViewText(R.id.row_expiry,
                        c.getString(R.string.widget_pantryExpirySoon, String.valueOf(r.expiryDays)));
                v.setViewVisibility(R.id.row_expiry, View.VISIBLE);
            } else {
                v.setViewVisibility(R.id.row_expiry, View.GONE);
            }
            boolean canUse = r.qty > 0;
            v.setImageViewResource(R.id.row_minus, canUse ? R.drawable.widget_minus : R.drawable.widget_minus_off);
            v.setContentDescription(R.id.row_minus_area, name + " " + c.getString(R.string.widget_pantryMinus));
            if (canUse) {
                Intent fill = new Intent();
                fill.putExtra(ToggleReceiver.EXTRA_TARGET, r.target);
                fill.putExtra(ToggleReceiver.EXTRA_ID, r.id);
                v.setOnClickFillInIntent(R.id.row_minus_area, fill);
            }
            return v;
        }

        private String subtitle(WidgetLogic.Row r) {
            StringBuilder b = new StringBuilder();
            if (r.date != null && day != null && !r.date.equals(day) && WidgetLogic.isYmd(r.date)) {
                b.append(WidgetRenderer.relativeDayLabel(c, r.date, day));
            }
            if (r.time != null && !r.time.isEmpty()) {
                if (b.length() > 0) b.append(' ');
                b.append(r.time);
            }
            String owner = WidgetRenderer.ownerLabel(c, snap, r.owner);
            if (owner != null) {
                if (b.length() > 0) b.append(" · ");
                b.append(owner);
            }
            return b.toString();
        }

        private static int sectionTitle(String key) {
            if (WidgetLogic.SECTION_ROUTINE.equals(key)) return R.string.widget_routineTitle;
            if (WidgetLogic.SECTION_KIDSNOTE.equals(key)) return R.string.widget_kidsnoteTitle;
            if (WidgetLogic.SECTION_SHOPPING.equals(key)) return R.string.widget_shoppingTitle;
            if (WidgetLogic.SECTION_PANTRY.equals(key)) return R.string.widget_pantryTitle;
            return R.string.widget_todayTitle;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            // section, note, checkbox item, pantry item
            return 4;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }
}
