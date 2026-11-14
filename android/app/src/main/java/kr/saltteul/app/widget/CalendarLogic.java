package kr.saltteul.app.widget;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Month calendar widget layout without Android types (design 2026-11-14 sections 2.3 to 2.8): the grid of weeks,
 * todo bars split at week boundaries, a lane for each bar, and the "+n" count of the bars that do not fit a day.
 * Mirrors the app's month view (monthGrid in shared/monthPlan.ts, layoutWeek in shared/todoDays.ts): Monday-first
 * weeks, column 0 = Monday and 6 = Sunday, the same lane order.
 */
public final class CalendarLogic {

    private CalendarLogic() {}

    /** Bars a day shows at most; the rest are counted in "+n". */
    public static final int MAX_LANES = 3;
    /** Always at least five week rows, so a February that fits four weeks looks like the other months. */
    static final int MIN_WEEKS = 5;
    /**
     * The calendar range read from Firestore starts this many days before the grid, so a done multi-day todo that
     * began earlier still shows (open todos are read whatever their date).
     */
    public static final int LOOKBACK_DAYS = 31;

    /** One month as the widget shows it: weeks rows of seven days from gridStart (a Monday). */
    public static final class Month {
        public final int year;
        public final int month;
        public final String gridStart;
        public final int weeks;

        Month(int year, int month, String gridStart, int weeks) {
            this.year = year;
            this.month = month;
            this.gridStart = gridStart;
            this.weeks = weeks;
        }

        public String gridEnd() {
            return WidgetLogic.addDays(gridStart, weeks * 7 - 1);
        }

        /** Day at a grid position (week row, column 0 = Monday). */
        public String dayAt(int week, int col) {
            return WidgetLogic.addDays(gridStart, week * 7 + col);
        }

        public boolean inMonth(String ymd) {
            int[] p = WidgetLogic.parseYmd(ymd);
            return p[0] == year && p[1] == month;
        }
    }

    /** Weekday (0 = Sunday ... 6 = Saturday, as WidgetLogic.weekdayOf) of a Monday-first column. */
    public static int weekdayOfCol(int col) {
        return (col + 1) % 7;
    }

    /** The month that contains day, with five or six week rows. */
    public static Month monthOf(String day) {
        int[] p = WidgetLogic.parseYmd(day);
        String first = WidgetLogic.makeYmd(p[0], p[1], 1);
        String nextFirst = p[1] == 12 ? WidgetLogic.makeYmd(p[0] + 1, 1, 1) : WidgetLogic.makeYmd(p[0], p[1] + 1, 1);
        String gridStart = WidgetLogic.addDays(first, -((WidgetLogic.weekdayOf(first) + 6) % 7));
        int days = WidgetLogic.diffDays(gridStart, nextFirst);
        int weeks = Math.max(MIN_WEEKS, (days + 6) / 7);
        return new Month(p[0], p[1], gridStart, weeks);
    }

    /** First day of the todo range to read for the calendar of day's month. */
    public static String fetchFrom(String day) {
        return WidgetLogic.addDays(monthOf(day).gridStart, -LOOKBACK_DAYS);
    }

    /** Last day of the todo range to read for the calendar of day's month. */
    public static String fetchTo(String day) {
        return monthOf(day).gridEnd();
    }

    /** One todo on the calendar, from start through end (inclusive). */
    public static final class Event {
        public final String id, title, owner, time, start, end;
        public final boolean done;

        Event(Snapshot.Todo t, String end) {
            this.id = t.id;
            this.title = t.title;
            this.owner = t.owner;
            this.time = t.time;
            this.start = t.date.substring(0, 10);
            this.end = end;
            this.done = t.done;
        }

        int days() {
            return WidgetLogic.diffDays(start, end) + 1;
        }
    }

    /**
     * The part of one event inside one week row: columns startCol..endCol (inclusive). continuesBefore/After say the
     * event goes on in the previous or next row (or outside the grid), so that end of the bar is drawn square.
     */
    public static final class Bar {
        public final Event event;
        public final int week;
        public final int startCol;
        public final int endCol;
        public final boolean continuesBefore;
        public final boolean continuesAfter;
        public int lane;

        Bar(Event event, int week, int startCol, int endCol, boolean continuesBefore, boolean continuesAfter) {
            this.event = event;
            this.week = week;
            this.startCol = startCol;
            this.endCol = endCol;
            this.continuesBefore = continuesBefore;
            this.continuesAfter = continuesAfter;
        }

        int span() {
            return endCol - startCol + 1;
        }
    }

    /** What the painter draws: visible bars (lane below maxLanes) and, per grid day, how many bars were left out. */
    public static final class Layout {
        public final Month month;
        public final List<Bar> bars;
        /** Index week * 7 + col. */
        public final int[] hidden;

        Layout(Month month, List<Bar> bars, int[] hidden) {
            this.month = month;
            this.bars = bars;
            this.hidden = hidden;
        }

        public int hiddenAt(int week, int col) {
            return hidden[week * 7 + col];
        }
    }

    /** Dated todos (done ones too) that touch the grid. Routines are a separate collection and never come in here. */
    public static List<Event> events(List<Snapshot.Todo> todos, Month m) {
        String from = m.gridStart;
        String to = m.gridEnd();
        List<Event> out = new ArrayList<>();
        for (Snapshot.Todo t : todos) {
            String end = WidgetLogic.endOf(t);
            if (end == null) continue;
            if (WidgetLogic.diffDays(t.date, to) < 0 || WidgetLogic.diffDays(from, end) < 0) continue;
            out.add(new Event(t, end));
        }
        return out;
    }

    /**
     * Within a week, as layoutWeek in shared/todoDays.ts: earlier start first (needed for the greedy lanes), longer
     * bars first, then the app's list order (sortTodos: open before done, timed by time, untimed last), then the
     * document id (the order Firestore lists them in).
     */
    private static final Comparator<Bar> ORDER = new Comparator<Bar>() {
        @Override
        public int compare(Bar a, Bar b) {
            if (a.startCol != b.startCol) return a.startCol - b.startCol;
            if (a.span() != b.span()) return b.span() - a.span();
            if (a.event.done != b.event.done) return a.event.done ? 1 : -1;
            String ta = a.event.time == null ? "99:99" : a.event.time;
            String tb = b.event.time == null ? "99:99" : b.event.time;
            int c = ta.compareTo(tb);
            return c != 0 ? c : WidgetLogic.nz(a.event.id).compareTo(WidgetLogic.nz(b.event.id));
        }
    };

    public static Layout layout(Month m, List<Snapshot.Todo> todos, int maxLanes) {
        List<Event> events = events(todos, m);
        List<Bar> visible = new ArrayList<>();
        int[] hidden = new int[m.weeks * 7];
        for (int w = 0; w < m.weeks; w++) {
            String weekStart = m.dayAt(w, 0);
            String weekEnd = m.dayAt(w, 6);
            List<Bar> week = new ArrayList<>();
            for (Event e : events) {
                if (WidgetLogic.diffDays(e.start, weekEnd) < 0 || WidgetLogic.diffDays(weekStart, e.end) < 0) continue;
                int s = Math.max(0, WidgetLogic.diffDays(weekStart, e.start));
                int t = Math.min(6, WidgetLogic.diffDays(weekStart, e.end));
                boolean before = WidgetLogic.diffDays(weekStart, e.start) < 0;
                boolean after = WidgetLogic.diffDays(e.end, weekEnd) < 0;
                week.add(new Bar(e, w, s, t, before, after));
            }
            Collections.sort(week, ORDER);
            // Greedy interval colouring: lanes[i] is the last column taken in lane i.
            List<Integer> lanes = new ArrayList<>();
            for (Bar b : week) {
                int lane = 0;
                while (lane < lanes.size() && lanes.get(lane) >= b.startCol) lane++;
                if (lane == lanes.size()) lanes.add(b.endCol);
                else lanes.set(lane, b.endCol);
                b.lane = lane;
                if (lane < maxLanes) {
                    visible.add(b);
                } else {
                    for (int col = b.startCol; col <= b.endCol; col++) hidden[w * 7 + col]++;
                }
            }
        }
        return new Layout(m, visible, hidden);
    }

    /** "2026.11": digits and a dot only, so it is not UI copy. */
    public static String monthLabel(Month m) {
        return m.year + "." + (m.month < 10 ? "0" : "") + m.month;
    }
}
