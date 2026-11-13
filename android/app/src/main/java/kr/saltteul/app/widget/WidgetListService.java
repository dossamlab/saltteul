package kr.saltteul.app.widget;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
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
    /** Tablet board column (WidgetLogic.COLUMN_*). */
    public static final String EXTRA_COLUMN = "kr.saltteul.app.widget.COLUMN";

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        String kind = intent.getStringExtra(EXTRA_KIND);
        String column = intent.getStringExtra(EXTRA_COLUMN);
        return new Factory(getApplicationContext(), kind == null ? WidgetLogic.KIND_DASHBOARD : kind,
                column == null ? WidgetLogic.COLUMN_ALL : column);
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private final String kind;
        private final String column;
        private List<WidgetLogic.Row> rows = new ArrayList<>();
        private Snapshot snap;
        private String day;

        Factory(Context c, String kind, String column) {
            this.c = c;
            this.kind = kind;
            this.column = column;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            try {
                long now = System.currentTimeMillis();
                snap = WidgetRepository.loadCache(c);
                day = WidgetLogic.householdDate(now);
                if (WidgetRepository.currentUid(c) == null) {
                    rows = new ArrayList<>();
                } else if (WidgetLogic.KIND_TABLET.equals(kind)) {
                    rows = WidgetLogic.tabletRows(snap, day, column, WidgetRepository.undoRoutine(c, now));
                } else {
                    rows = WidgetLogic.buildRows(snap, kind, day);
                }
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
                v.setTextViewText(R.id.row_section, sectionText(r));
                return v;
            }
            if (r.type == WidgetLogic.Row.CHIPS) return chipsRow(r);
            if (r.type == WidgetLogic.Row.SUMMARY) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_summary);
                v.setTextViewText(R.id.row_summary, summaryText(r));
                return v;
            }
            if (r.type == WidgetLogic.Row.NOTE) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_note);
                v.setTextViewText(R.id.row_note, noteText(r));
                return v;
            }
            if (r.type == WidgetLogic.Row.UNDO) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_undo);
                v.setTextViewText(R.id.row_undo, c.getString(R.string.widget_routineUndo, r.title == null ? "" : r.title));
                Intent fill = new Intent();
                fill.putExtra(ToggleReceiver.EXTRA_TARGET, r.target);
                fill.putExtra(ToggleReceiver.EXTRA_ID, r.id);
                fill.putExtra(ToggleReceiver.EXTRA_CHECKED, true);
                v.setOnClickFillInIntent(R.id.row_undo_area, fill);
                return v;
            }
            if (WidgetLogic.TARGET_PANTRY.equals(r.target)) return pantryRow(r);
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_item);
            boolean tablet = WidgetLogic.KIND_TABLET.equals(kind);
            String title = tablet ? WidgetLogic.displayTitle(r.title, r.source) : r.title == null ? "" : r.title;
            v.setTextViewText(R.id.row_title, title);
            v.setTextColor(R.id.row_title, ContextCompat.getColor(c, r.checked ? R.color.widget_ink_3 : R.color.widget_ink));
            v.setImageViewResource(R.id.row_check, r.checked ? R.drawable.widget_check_on : R.drawable.widget_check_off);
            String sub = subtitle(r, !tablet);
            v.setTextViewText(R.id.row_sub, sub);
            v.setViewVisibility(R.id.row_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
            String owner = WidgetRenderer.ownerLabel(c, snap, r.owner);
            if (tablet) {
                // The owner shows as the checkbox colour instead of a text line; titles get two lines.
                // A transparent filter leaves the ticked box (filled sage with a white tick) as drawn.
                v.setInt(R.id.row_check, "setColorFilter",
                        r.checked ? Color.TRANSPARENT : ContextCompat.getColor(c, ownerColor(r.owner)));
                v.setInt(R.id.row_title, "setMaxLines", 2);
                v.setViewVisibility(R.id.row_dot, "kidsnote".equals(r.source) ? View.VISIBLE : View.GONE);
                v.setContentDescription(R.id.row_check_area, owner == null ? title : title + ", " + owner);
            } else {
                v.setContentDescription(R.id.row_check_area, title);
            }

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

        /** Two routine chips, tinted by owner; tapping one ticks that routine. */
        private RemoteViews chipsRow(WidgetLogic.Row r) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_chips);
            int[] ids = {R.id.row_chip_1, R.id.row_chip_2};
            for (int i = 0; i < ids.length; i++) {
                if (r.items == null || i >= r.items.size()) {
                    v.setViewVisibility(ids[i], View.INVISIBLE);
                    continue;
                }
                WidgetLogic.Row it = r.items.get(i);
                String title = it.title == null ? "" : it.title;
                v.setViewVisibility(ids[i], View.VISIBLE);
                v.setTextViewText(ids[i], title);
                v.setInt(ids[i], "setBackgroundResource", chipBackground(it.owner));
                String owner = WidgetRenderer.ownerLabel(c, snap, it.owner);
                v.setContentDescription(ids[i], owner == null ? title : title + ", " + owner);
                Intent fill = new Intent();
                fill.putExtra(ToggleReceiver.EXTRA_TARGET, it.target);
                fill.putExtra(ToggleReceiver.EXTRA_ID, it.id);
                fill.putExtra(ToggleReceiver.EXTRA_CHECKED, it.checked);
                v.setOnClickFillInIntent(ids[i], fill);
            }
            return v;
        }

        /** "우유, 햇반 +3개 더" or "물티슈 부족 · 우유 기한 1일". */
        private String summaryText(WidgetLogic.Row r) {
            boolean pantry = WidgetLogic.SECTION_PANTRY.equals(r.key);
            StringBuilder b = new StringBuilder();
            if (r.items != null) {
                for (WidgetLogic.Row it : r.items) {
                    if (b.length() > 0) b.append(pantry ? " · " : ", ");
                    b.append(it.title == null ? "" : it.title);
                    if (pantry) b.append(' ').append(pantryState(it));
                }
            }
            if (r.count > 0) b.append(' ').append(c.getString(R.string.widget_more, String.valueOf(r.count)));
            return b.toString();
        }

        private String pantryState(WidgetLogic.Row it) {
            if (it.low) return c.getString(R.string.widget_pantryLow);
            if (it.expired) return c.getString(R.string.widget_pantryExpired);
            return c.getString(R.string.widget_pantryExpirySoon, String.valueOf(it.expiryDays == null ? 0 : it.expiryDays));
        }

        private String subtitle(WidgetLogic.Row r, boolean withOwner) {
            StringBuilder b = new StringBuilder();
            if (r.date != null && day != null && !r.date.equals(day) && WidgetLogic.isYmd(r.date)) {
                b.append(WidgetRenderer.relativeDayLabel(c, r.date, day));
            }
            if (r.time != null && !r.time.isEmpty()) {
                if (b.length() > 0) b.append(' ');
                b.append(r.time);
            }
            String owner = withOwner ? WidgetRenderer.ownerLabel(c, snap, r.owner) : null;
            if (owner != null) {
                if (b.length() > 0) b.append(" · ");
                b.append(owner);
            }
            return b.toString();
        }

        private String noteText(WidgetLogic.Row r) {
            if (WidgetLogic.NOTE_MORE.equals(r.key)) return c.getString(R.string.widget_more, String.valueOf(r.count));
            return c.getString(R.string.widget_allDone);
        }

        private String sectionText(WidgetLogic.Row r) {
            if (WidgetLogic.SECTION_ROUTINE.equals(r.key)) {
                return r.total > 0
                        ? c.getString(R.string.widget_routineProgress, String.valueOf(r.count), String.valueOf(r.total))
                        : c.getString(R.string.widget_routineTitle);
            }
            if (WidgetLogic.SECTION_KIDSNOTE.equals(r.key)) return c.getString(R.string.widget_kidsnoteTitle);
            if (WidgetLogic.SECTION_PANTRY.equals(r.key)) return c.getString(R.string.widget_pantryTitle);
            if (WidgetLogic.SECTION_SHOPPING.equals(r.key)) {
                return r.count > 0 ? c.getString(R.string.widget_shoppingCount, String.valueOf(r.count))
                        : c.getString(R.string.widget_shoppingTitle);
            }
            return r.count > 0 ? c.getString(R.string.widget_todayCount, String.valueOf(r.count))
                    : c.getString(R.string.widget_todayTitle);
        }

        private static int ownerColor(String owner) {
            if ("husband".equals(owner)) return R.color.widget_owner_husband;
            if ("wife".equals(owner)) return R.color.widget_owner_wife;
            return R.color.widget_owner_both;
        }

        private static int chipBackground(String owner) {
            if ("husband".equals(owner)) return R.drawable.widget_chip_husband;
            if ("wife".equals(owner)) return R.drawable.widget_chip_wife;
            return R.drawable.widget_chip_both;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            // section, note, checkbox item, pantry item, undo, routine chips, summary
            return 7;
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
