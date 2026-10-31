package kr.saltteul.app.widget;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Pure logic shared by all widgets: household day (port of shared/householdDate.ts),
 * routines (shared/routines.ts), anniversaries (shared/anniversaries.ts), pantry (shared/pantry.ts)
 * and the rows each widget shows. No Android types here so it runs in plain JVM unit tests.
 * Dates are 'YYYY-MM-DD' strings on the Asia/Seoul calendar.
 */
public final class WidgetLogic {

    private WidgetLogic() {}

    public static final String KIND_DASHBOARD = "dashboard";
    public static final String KIND_TODO = "todo";
    public static final String KIND_TABLET = "tablet";

    public static final String TARGET_TODO = "todo";
    public static final String TARGET_ROUTINE = "routine";
    public static final String TARGET_SHOPPING = "shopping";
    /** Pantry rows have a −1 button instead of a checkbox. */
    public static final String TARGET_PANTRY = "pantry";

    public static final String SECTION_TODAY = "today";
    public static final String SECTION_ROUTINE = "routine";
    public static final String SECTION_KIDSNOTE = "kidsnote";
    public static final String SECTION_SHOPPING = "shopping";
    public static final String SECTION_PANTRY = "pantry";
    public static final String NOTE_ALL_DONE = "allDone";

    static final int DASHBOARD_TODOS = 3;
    static final int TODO_WIDGET_ROWS = 4;
    static final int TABLET_TODOS = 6;
    static final int TABLET_KIDSNOTE = 3;
    static final int TABLET_SHOPPING = 6;
    static final int TABLET_PANTRY = 8;

    /** Expiry within this many days (or already past) shows a badge (shared/pantry.ts EXPIRY_SOON_DAYS). */
    static final int EXPIRY_SOON_DAYS = 7;
    /**
     * Unit for items saved without one: the same data default as qtyLabel in shared/pantry.ts
     * ('개' is the counting word gae). It is stored data, not UI copy, so it is not a string resource.
     */
    static final String DEFAULT_PANTRY_UNIT = "개";

    // Seoul has no DST, so a fixed +9h offset is exact.
    static final long HOUR_MS = 60L * 60 * 1000;
    static final long DAY_MS = 24 * HOUR_MS;
    static final long KST_OFFSET_MS = 9 * HOUR_MS;
    static final long DAY_START_MS = 4 * HOUR_MS;
    /** Widgets redraw a minute after the household day starts (04:01 KST). */
    static final long ROLLOVER_MS = DAY_START_MS + 60_000L;

    // ---------- calendar arithmetic (proleptic Gregorian, no java.time: minSdk 24) ----------

    static long daysFromCivil(int y, int m, int d) {
        y -= m <= 2 ? 1 : 0;
        long era = (y >= 0 ? y : y - 399) / 400;
        long yoe = y - era * 400;
        long doy = (153L * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    static int[] civilFromDays(long z) {
        z += 719468;
        long era = (z >= 0 ? z : z - 146096) / 146097;
        long doe = z - era * 146097;
        long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        long y = yoe + era * 400;
        long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        long mp = (5 * doy + 2) / 153;
        long d = doy - (153 * mp + 2) / 5 + 1;
        long m = mp + (mp < 10 ? 3 : -9);
        return new int[] {(int) (y + (m <= 2 ? 1 : 0)), (int) m, (int) d};
    }

    public static String makeYmd(int y, int m, int d) {
        return String.format(Locale.US, "%04d-%02d-%02d", y, m, d);
    }

    /** [year, month, day]; throws IllegalArgumentException for malformed input. */
    public static int[] parseYmd(String ymd) {
        if (ymd == null || ymd.length() < 10 || ymd.charAt(4) != '-' || ymd.charAt(7) != '-') {
            throw new IllegalArgumentException("bad date: " + ymd);
        }
        try {
            return new int[] {
                Integer.parseInt(ymd.substring(0, 4)),
                Integer.parseInt(ymd.substring(5, 7)),
                Integer.parseInt(ymd.substring(8, 10))
            };
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("bad date: " + ymd, e);
        }
    }

    public static boolean isYmd(String s) {
        try {
            parseYmd(s);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    static long epochDay(String ymd) {
        int[] p = parseYmd(ymd);
        return daysFromCivil(p[0], p[1], p[2]);
    }

    static String fromEpochDay(long days) {
        int[] c = civilFromDays(days);
        return makeYmd(c[0], c[1], c[2]);
    }

    /** Calendar date in Asia/Seoul. */
    public static String seoulDate(long nowMillis) {
        return fromEpochDay(Math.floorDiv(nowMillis + KST_OFFSET_MS, DAY_MS));
    }

    /** 'HH:mm' in Asia/Seoul. */
    public static String seoulTime(long nowMillis) {
        long msOfDay = Math.floorMod(nowMillis + KST_OFFSET_MS, DAY_MS);
        long minutes = msOfDay / 60_000L;
        return String.format(Locale.US, "%02d:%02d", minutes / 60, minutes % 60);
    }

    /** Household day: 04:00 to 03:59 KST, so 02:00 counts toward the previous day. */
    public static String householdDate(long nowMillis) {
        return seoulDate(nowMillis - DAY_START_MS);
    }

    public static String addDays(String ymd, int n) {
        return fromEpochDay(epochDay(ymd) + n);
    }

    /** b - a in days. */
    public static int diffDays(String a, String b) {
        return (int) (epochDay(b) - epochDay(a));
    }

    /** 0 = Sunday ... 6 = Saturday */
    public static int weekdayOf(String ymd) {
        // 1970-01-01 was a Thursday (4).
        return (int) Math.floorMod(epochDay(ymd) + 4, 7L);
    }

    public static boolean isValidYmd(int y, int m, int d) {
        if (m < 1 || m > 12 || d < 1) return false;
        int[] c = civilFromDays(daysFromCivil(y, m, d));
        return c[0] == y && c[1] == m && c[2] == d;
    }

    /** Next 04:01 KST strictly after now (epoch millis), for the daily routine reset. */
    public static long nextRolloverMillis(long nowMillis) {
        long seoulDayStart = Math.floorDiv(nowMillis + KST_OFFSET_MS, DAY_MS) * DAY_MS - KST_OFFSET_MS;
        long candidate = seoulDayStart + ROLLOVER_MS;
        return candidate > nowMillis ? candidate : candidate + DAY_MS;
    }

    // ---------- routines ----------

    public static String routineLogId(String routineId, String day) {
        return routineId + "_" + day;
    }

    public static List<Snapshot.Routine> routinesForDay(List<Snapshot.Routine> routines, String day) {
        int wd = weekdayOf(day);
        List<Snapshot.Routine> out = new ArrayList<>();
        for (Snapshot.Routine r : routines) {
            if (!r.active) continue;
            if (r.weekdays == null || r.weekdays.length == 0 || contains(r.weekdays, wd)) out.add(r);
        }
        Collections.sort(out, new Comparator<Snapshot.Routine>() {
            @Override
            public int compare(Snapshot.Routine a, Snapshot.Routine b) {
                return Double.compare(a.order, b.order);
            }
        });
        return out;
    }

    private static boolean contains(int[] arr, int v) {
        for (int x : arr) if (x == v) return true;
        return false;
    }

    // ---------- anniversaries ----------

    private static String onYear(String original, int year) {
        int[] p = parseYmd(original);
        if (p[1] == 2 && p[2] == 29 && !isValidYmd(year, 2, 29)) return makeYmd(year, 2, 28);
        return makeYmd(year, p[1], p[2]);
    }

    /** Next yearly occurrence on or after today. Feb 29 falls on Feb 28 in common years. */
    public static String nextOccurrence(String original, String today) {
        int year = parseYmd(today)[0];
        String thisYear = onYear(original, year);
        return diffDays(today, thisYear) >= 0 ? thisYear : onYear(original, year + 1);
    }

    public static final class Upcoming {
        public final String title;
        public final String next;
        public final int daysLeft;

        Upcoming(String title, String next, int daysLeft) {
            this.title = title;
            this.next = next;
            this.daysLeft = daysLeft;
        }
    }

    /** Nearest yearly anniversary; 'together' is a day counter so it is skipped. Null if none. */
    public static Upcoming nearestAnniversary(List<Snapshot.Anniversary> list, String today) {
        Upcoming best = null;
        for (Snapshot.Anniversary a : list) {
            if ("together".equals(a.kind) || !isYmd(a.date)) continue;
            String next = nextOccurrence(a.date, today);
            int left = diffDays(today, next);
            if (best == null || left < best.daysLeft) best = new Upcoming(a.title, next, left);
        }
        return best;
    }

    /** Symbol-only D-day label ("D-day", "D-3"). */
    public static String dDayLabel(int daysLeft) {
        return daysLeft == 0 ? "D-day" : "D-" + daysLeft;
    }

    // ---------- pantry (keep in step with shared/pantry.ts) ----------

    public static boolean isLow(Snapshot.Pantry p) {
        return p.qty <= p.minQty;
    }

    /** Days until expiry (negative when past), or null when the item has no expiry. */
    public static Integer daysToExpiry(Snapshot.Pantry p, String today) {
        return isYmd(p.expiry) ? Integer.valueOf(diffDays(today, p.expiry)) : null;
    }

    public static boolean expiresSoon(Snapshot.Pantry p, String today) {
        Integer d = daysToExpiry(p, today);
        return d != null && d <= EXPIRY_SOON_DAYS;
    }

    /** Past the expiry date: the badge reads "expired" instead of "N days". */
    public static boolean isExpired(Snapshot.Pantry p, String today) {
        Integer d = daysToExpiry(p, today);
        return d != null && d < 0;
    }

    private static int pantryRank(Snapshot.Pantry p, String today) {
        return isLow(p) ? 0 : expiresSoon(p, today) ? 1 : 2;
    }

    /** Low items first, then items expiring soon, then by name (Korean collation). */
    public static List<Snapshot.Pantry> sortPantry(List<Snapshot.Pantry> list, final String today) {
        List<Snapshot.Pantry> out = new ArrayList<>(list);
        final Collator ko = Collator.getInstance(Locale.KOREAN);
        Collections.sort(out, new Comparator<Snapshot.Pantry>() {
            @Override
            public int compare(Snapshot.Pantry a, Snapshot.Pantry b) {
                int c = pantryRank(a, today) - pantryRank(b, today);
                return c != 0 ? c : ko.compare(nz(a.name), nz(b.name));
            }
        });
        return out;
    }

    /** Count after the widget's −1 ('use' 1 in applyPantryOp): never below zero. */
    public static long pantryAfterUse(long before) {
        return Math.max(0, before - 1);
    }

    /** Whole, non-negative amount for a count change (applyPantryOp rounds the same way). */
    public static long pantryAmount(double amount) {
        return Math.max(0, Math.round(amount));
    }

    /**
     * Count after ticking a linked shopping item: bought adds the amount ('buy'), unticking takes it
     * back off ('use'). Never below zero (applyPantryOp in shared/pantry.ts).
     */
    public static long pantryAfterShopping(long before, long amount, boolean bought) {
        return Math.max(0, bought ? before + amount : before - amount);
    }

    public static String pantryUnit(String unit) {
        return unit == null || unit.trim().isEmpty() ? DEFAULT_PANTRY_UNIT : unit.trim();
    }

    /** Optimistic −1 on the cached snapshot. False when the item is unknown or already at zero. */
    public static boolean applyPantryUse(Snapshot s, String id) {
        if (s == null || id == null) return false;
        for (Snapshot.Pantry p : s.pantry) {
            if (!id.equals(p.id)) continue;
            if (p.qty <= 0) return false;
            p.qty = (int) pantryAfterUse(p.qty);
            return true;
        }
        return false;
    }

    // ---------- small formatting helpers ----------

    /** Replaces {key} tokens in a copy template, e.g. fill("{m}/{d}", "m", "10", "d", "28"). */
    public static String fill(String template, String... keyValues) {
        String out = template == null ? "" : template;
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            out = out.replace("{" + keyValues[i] + "}", keyValues[i + 1] == null ? "" : keyValues[i + 1]);
        }
        return out;
    }

    public static Snapshot.Weather weatherFor(Snapshot s, String day) {
        for (Snapshot.Weather w : s.weather) if (day.equals(w.day)) return w;
        return null;
    }

    /** "12° / 20° · 60%" built from symbols and numbers only. Empty when nothing is known. */
    public static String weatherLabel(Snapshot.Weather w) {
        if (w == null) return "";
        StringBuilder b = new StringBuilder();
        if (w.minC != null || w.maxC != null) {
            b.append(w.minC == null ? "-" : String.valueOf(Math.round(w.minC))).append("° / ");
            b.append(w.maxC == null ? "-" : String.valueOf(Math.round(w.maxC))).append('°');
        }
        if (w.popMax != null) {
            if (b.length() > 0) b.append(" · ");
            b.append(Math.round(w.popMax)).append('%');
        }
        return b.toString();
    }

    // ---------- rows ----------

    public static final class Row {
        public static final int SECTION = 0;
        public static final int ITEM = 1;
        public static final int NOTE = 2;

        public final int type;
        /** SECTION_* for sections, NOTE_* for notes. */
        public String key;
        /** TARGET_* for toggleable items. */
        public String target;
        public String id;
        public String title;
        public boolean checked;
        public String date;
        public String time;
        public String owner;
        public String consumableId;
        public String pantryId;
        /**
         * Pantry rows: count, unit (never empty), low marker, days to expiry when the badge shows (else null),
         * and expired (days &lt; 0: "expired" badge; 0..7 shows the day count).
         */
        public int qty;
        public String unit;
        public boolean low;
        public Integer expiryDays;
        public boolean expired;

        Row(int type) {
            this.type = type;
        }

        static Row section(String key) {
            Row r = new Row(SECTION);
            r.key = key;
            return r;
        }

        static Row note(String key) {
            Row r = new Row(NOTE);
            r.key = key;
            return r;
        }

        static Row todo(Snapshot.Todo t) {
            Row r = new Row(ITEM);
            r.target = TARGET_TODO;
            r.id = t.id;
            r.title = t.title;
            r.date = t.date;
            r.time = t.time;
            r.owner = t.owner;
            r.checked = t.done;
            return r;
        }

        static Row routine(Snapshot.Routine rt, boolean done) {
            Row r = new Row(ITEM);
            r.target = TARGET_ROUTINE;
            r.id = rt.id;
            r.title = rt.title;
            r.owner = rt.owner;
            r.checked = done;
            return r;
        }

        static Row shop(Snapshot.Shop s) {
            Row r = new Row(ITEM);
            r.target = TARGET_SHOPPING;
            r.id = s.id;
            r.title = s.name;
            r.consumableId = s.consumableId;
            r.pantryId = s.pantryId;
            r.checked = s.bought;
            return r;
        }

        static Row pantry(Snapshot.Pantry p, String today) {
            Row r = new Row(ITEM);
            r.target = TARGET_PANTRY;
            r.id = p.id;
            r.title = p.name;
            r.qty = p.qty;
            r.unit = pantryUnit(p.unit);
            r.low = isLow(p);
            r.expiryDays = expiresSoon(p, today) ? daysToExpiry(p, today) : null;
            r.expired = isExpired(p, today);
            return r;
        }
    }

    private static final Comparator<Snapshot.Todo> BY_DATE_TIME = new Comparator<Snapshot.Todo>() {
        @Override
        public int compare(Snapshot.Todo a, Snapshot.Todo b) {
            int c = nz(a.date).compareTo(nz(b.date));
            if (c != 0) return c;
            // Untimed todos go after timed ones.
            String ta = a.time == null ? "99:99" : a.time;
            String tb = b.time == null ? "99:99" : b.time;
            c = ta.compareTo(tb);
            return c != 0 ? c : nz(a.title).compareTo(nz(b.title));
        }
    };

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    /** Open todos dated today, by time. */
    public static List<Snapshot.Todo> openTodayTodos(Snapshot s, String day) {
        List<Snapshot.Todo> out = new ArrayList<>();
        for (Snapshot.Todo t : s.todos) if (!t.done && day.equals(t.date)) out.add(t);
        Collections.sort(out, BY_DATE_TIME);
        return out;
    }

    /** Open kidsnote todos dated today or later, soonest first. */
    public static List<Snapshot.Todo> upcomingKidsnote(Snapshot s, String day, int limit) {
        List<Snapshot.Todo> out = new ArrayList<>();
        for (Snapshot.Todo t : s.todos) {
            if (t.done || !"kidsnote".equals(t.source) || !isYmd(t.date)) continue;
            if (diffDays(day, t.date) >= 0) out.add(t);
        }
        Collections.sort(out, BY_DATE_TIME);
        return out.size() > limit ? new ArrayList<>(out.subList(0, limit)) : out;
    }

    public static List<Snapshot.Shop> openShopping(Snapshot s) {
        List<Snapshot.Shop> out = new ArrayList<>();
        for (Snapshot.Shop i : s.shopping) if (!i.bought) out.add(i);
        Collections.sort(out, new Comparator<Snapshot.Shop>() {
            @Override
            public int compare(Snapshot.Shop a, Snapshot.Shop b) {
                return Long.compare(a.createdAt, b.createdAt);
            }
        });
        return out;
    }

    public static boolean isRoutineDone(Snapshot s, String routineId, String day) {
        return s.routineLogIds.contains(routineLogId(routineId, day));
    }

    /** Today's routines that are not done yet. */
    public static List<Snapshot.Routine> openRoutines(Snapshot s, String day) {
        List<Snapshot.Routine> out = new ArrayList<>();
        for (Snapshot.Routine r : routinesForDay(s.routines, day)) if (!isRoutineDone(s, r.id, day)) out.add(r);
        return out;
    }

    /** "N left" on the 2x2 widget: open todos for today + routines not done today. */
    public static int todoWidgetLeft(Snapshot s, String day) {
        return openTodayTodos(s, day).size() + openRoutines(s, day).size();
    }

    public static List<Row> buildRows(Snapshot s, String kind, String day) {
        List<Row> rows = new ArrayList<>();
        if (s == null || !Snapshot.STATUS_OK.equals(s.status)) return rows;
        List<Snapshot.Todo> today = openTodayTodos(s, day);
        if (KIND_DASHBOARD.equals(kind)) {
            for (int i = 0; i < today.size() && i < DASHBOARD_TODOS; i++) rows.add(Row.todo(today.get(i)));
        } else if (KIND_TODO.equals(kind)) {
            for (Snapshot.Todo t : today) {
                if (rows.size() >= TODO_WIDGET_ROWS) break;
                rows.add(Row.todo(t));
            }
            for (Snapshot.Routine r : openRoutines(s, day)) {
                if (rows.size() >= TODO_WIDGET_ROWS) break;
                rows.add(Row.routine(r, false));
            }
        } else if (KIND_TABLET.equals(kind)) {
            rows.add(Row.section(SECTION_TODAY));
            if (today.isEmpty()) rows.add(Row.note(NOTE_ALL_DONE));
            for (int i = 0; i < today.size() && i < TABLET_TODOS; i++) rows.add(Row.todo(today.get(i)));

            List<Snapshot.Routine> routines = routinesForDay(s.routines, day);
            if (!routines.isEmpty()) {
                rows.add(Row.section(SECTION_ROUTINE));
                for (Snapshot.Routine r : routines) rows.add(Row.routine(r, isRoutineDone(s, r.id, day)));
            }
            List<Snapshot.Todo> kids = upcomingKidsnote(s, day, TABLET_KIDSNOTE);
            if (!kids.isEmpty()) {
                rows.add(Row.section(SECTION_KIDSNOTE));
                for (Snapshot.Todo t : kids) rows.add(Row.todo(t));
            }
            List<Snapshot.Shop> shop = openShopping(s);
            if (!shop.isEmpty()) {
                rows.add(Row.section(SECTION_SHOPPING));
                for (int i = 0; i < shop.size() && i < TABLET_SHOPPING; i++) rows.add(Row.shop(shop.get(i)));
            }
            // Every pantry item in pantry order (low, expiring, name), capped like the other sections.
            List<Snapshot.Pantry> pantry = sortPantry(s.pantry, day);
            if (!pantry.isEmpty()) {
                rows.add(Row.section(SECTION_PANTRY));
                for (int i = 0; i < pantry.size() && i < TABLET_PANTRY; i++) rows.add(Row.pantry(pantry.get(i), day));
            }
        }
        return rows;
    }

    // ---------- optimistic toggle ----------

    /**
     * Applies a checkbox tap to the cached snapshot so the widget redraws before Firestore answers.
     * wasChecked is the state the row showed when tapped (unused for the pantry −1).
     */
    public static void applyToggle(Snapshot s, String target, String id, boolean wasChecked, String day) {
        if (s == null || id == null) return;
        if (TARGET_PANTRY.equals(target)) {
            applyPantryUse(s, id);
        } else if (TARGET_TODO.equals(target)) {
            for (Snapshot.Todo t : s.todos) if (id.equals(t.id)) t.done = !wasChecked;
        } else if (TARGET_SHOPPING.equals(target)) {
            for (Snapshot.Shop i : s.shopping) if (id.equals(i.id)) i.bought = !wasChecked;
        } else if (TARGET_ROUTINE.equals(target)) {
            String logId = routineLogId(id, day);
            Set<String> ids = new HashSet<>(s.routineLogIds);
            if (wasChecked) ids.remove(logId);
            else ids.add(logId);
            s.routineLogIds.clear();
            s.routineLogIds.addAll(ids);
            Collections.sort(s.routineLogIds);
        }
    }

    /** Purchases list after buying today (web: toggleShopping in src/data/actions.ts). */
    public static List<String> purchasesAfterBuy(List<String> purchases, String today, boolean bought) {
        List<String> out = new ArrayList<>();
        if (purchases != null) for (String p : purchases) if (!today.equals(p)) out.add(p);
        if (bought) out.add(today);
        Collections.sort(out);
        return out;
    }
}
