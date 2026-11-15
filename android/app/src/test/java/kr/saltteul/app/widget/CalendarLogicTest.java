package kr.saltteul.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** Monday-first weeks like the app's month view: column 0 = Monday, 5 = Saturday, 6 = Sunday. */
public class CalendarLogicTest {

    private static Snapshot.Todo todo(String id, String date, String endDate, String owner) {
        Snapshot.Todo t = new Snapshot.Todo(id, id, date, null, owner, "manual");
        t.endDate = endDate;
        return t;
    }

    private static List<CalendarLogic.Bar> barsOf(CalendarLogic.Layout l, String id) {
        List<CalendarLogic.Bar> out = new ArrayList<>();
        for (CalendarLogic.Bar b : l.bars) if (id.equals(b.event.id)) out.add(b);
        return out;
    }

    @Test
    public void events_dropTheKidsnotePrefixFromTitles() {
        Snapshot.Todo kn = new Snapshot.Todo("k", "[키즈노트] 견학", "2026-11-06", null, "both", "kidsnote");
        Snapshot.Todo own = new Snapshot.Todo("m", "[메모] 장보기", "2026-11-06", null, "wife", "manual");
        List<Snapshot.Todo> list = new ArrayList<>();
        list.add(kn);
        list.add(own);
        List<CalendarLogic.Event> ev = CalendarLogic.events(list, CalendarLogic.monthOf("2026-11-14"));
        assertEquals("견학", ev.stream().filter(e -> e.id.equals("k")).findFirst().get().title);
        assertEquals("[메모] 장보기", ev.stream().filter(e -> e.id.equals("m")).findFirst().get().title);
    }

    // ---------- grid ----------

    @Test
    public void month_november2026StartsOnTheMondayBeforeAndHasSixWeeks() {
        // 2026-11-01 is a Sunday: the grid starts Monday 10-26 and November ends on a Monday.
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        assertEquals(2026, m.year);
        assertEquals(11, m.month);
        assertEquals("2026-10-26", m.gridStart);
        assertEquals(6, m.weeks);
        assertEquals("2026-12-06", m.gridEnd());
        assertEquals("2026-11-14", m.dayAt(2, 5)); // Saturday
        assertEquals(1, WidgetLogic.weekdayOf(m.dayAt(0, 0))); // Monday
        assertEquals(0, WidgetLogic.weekdayOf(m.dayAt(0, 6))); // Sunday
        assertTrue(m.inMonth("2026-11-30"));
        assertFalse(m.inMonth("2026-12-01"));
        assertEquals("2026.11", CalendarLogic.monthLabel(m));
    }

    @Test
    public void month_fiveWeeksAndIntoNextYear() {
        // 2026-12-01 is a Tuesday, 12-31 a Thursday.
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-12-31");
        assertEquals("2026-11-30", m.gridStart);
        assertEquals(5, m.weeks);
        assertEquals("2027-01-03", m.gridEnd());
        assertEquals("2026.12", CalendarLogic.monthLabel(m));
    }

    @Test
    public void month_fourWeekFebruaryStillGetsFiveRows() {
        // 2027-02-01 is a Monday and February 2027 has 28 days.
        CalendarLogic.Month m = CalendarLogic.monthOf("2027-02-10");
        assertEquals("2027-02-01", m.gridStart);
        assertEquals(5, m.weeks);
    }

    @Test
    public void weekdayOfCol_mondayFirst() {
        assertEquals(1, CalendarLogic.weekdayOfCol(0));
        assertEquals(6, CalendarLogic.weekdayOfCol(5));
        assertEquals(0, CalendarLogic.weekdayOfCol(6));
    }

    @Test
    public void fetchRange_coversTheGridWithALookback() {
        assertEquals("2026-09-25", CalendarLogic.fetchFrom("2026-11-14"));
        assertEquals("2026-12-06", CalendarLogic.fetchTo("2026-11-14"));
    }

    // ---------- events and bars ----------

    @Test
    public void events_keepGridOverlapOnlyAndUseTheEndDate() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        todos.add(todo("before", "2026-10-10", null, "wife")); // ends before the grid
        todos.add(todo("into", "2026-10-22", "2026-10-27", "wife")); // starts before, runs into the grid
        todos.add(todo("after", "2026-12-07", null, "wife")); // after the grid
        todos.add(todo("next", "2026-12-03", null, "wife")); // next month, still on the grid
        todos.add(todo("undated", null, null, "wife"));
        List<CalendarLogic.Event> ev = CalendarLogic.events(todos, m);
        assertEquals(2, ev.size());
        assertEquals("into", ev.get(0).id);
        assertEquals("2026-10-27", ev.get(0).end);
        assertEquals("next", ev.get(1).id);
    }

    @Test
    public void bars_multiDayContinuesOnTheNextWeekRow() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        // Fri 11-06 to Tue 11-10.
        todos.add(todo("trip", "2026-11-06", "2026-11-10", "husband"));
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 3);
        List<CalendarLogic.Bar> bars = barsOf(l, "trip");
        assertEquals(2, bars.size());
        CalendarLogic.Bar a = bars.get(0);
        assertEquals(1, a.week);
        assertEquals(4, a.startCol);
        assertEquals(6, a.endCol);
        assertFalse(a.continuesBefore);
        assertTrue(a.continuesAfter);
        CalendarLogic.Bar b = bars.get(1);
        assertEquals(2, b.week);
        assertEquals(0, b.startCol);
        assertEquals(1, b.endCol);
        assertTrue(b.continuesBefore);
        assertFalse(b.continuesAfter);
    }

    @Test
    public void bars_startingBeforeTheGridIsSquareOnTheLeft() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        todos.add(todo("into", "2026-10-22", "2026-10-27", "wife"));
        CalendarLogic.Bar b = CalendarLogic.layout(m, todos, 3).bars.get(0);
        assertEquals(0, b.week);
        assertEquals(0, b.startCol);
        assertEquals(1, b.endCol);
        assertTrue(b.continuesBefore);
        assertFalse(b.continuesAfter);
    }

    @Test
    public void bars_endDateOnOrBeforeStartIsOneDay() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        todos.add(todo("same", "2026-11-11", "2026-11-11", "wife"));
        todos.add(todo("back", "2026-11-12", "2026-11-03", "wife"));
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 3);
        assertEquals(2, l.bars.size());
        for (CalendarLogic.Bar b : l.bars) assertEquals(b.startCol, b.endCol);
    }

    @Test
    public void lanes_longerBarsFirstAndFreeLanesReused() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        todos.add(todo("short", "2026-11-09", null, "wife")); // Mon
        todos.add(todo("long", "2026-11-09", "2026-11-12", "husband")); // Mon-Thu
        todos.add(todo("thu", "2026-11-12", null, "both")); // Thu
        todos.add(todo("fri", "2026-11-13", null, "both")); // Fri: lane 0 is free again
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 3);
        assertEquals(0, barsOf(l, "long").get(0).lane);
        assertEquals(1, barsOf(l, "short").get(0).lane);
        assertEquals(1, barsOf(l, "thu").get(0).lane);
        assertEquals(0, barsOf(l, "fri").get(0).lane);
    }

    @Test
    public void lanes_tiesFollowTheAppListOrderOpenThenTime() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        Snapshot.Todo done = todo("a-done", "2026-11-10", null, "wife");
        done.time = "07:00";
        done.done = true;
        todos.add(done);
        todos.add(todo("b-untimed", "2026-11-10", null, "wife"));
        Snapshot.Todo timed = todo("c-timed", "2026-11-10", null, "wife");
        timed.time = "09:00";
        todos.add(timed);
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 3);
        assertEquals(0, barsOf(l, "c-timed").get(0).lane);
        assertEquals(1, barsOf(l, "b-untimed").get(0).lane);
        assertEquals(2, barsOf(l, "a-done").get(0).lane);
        assertTrue(barsOf(l, "a-done").get(0).event.done);
    }

    @Test
    public void overflow_threeBarsADayAndTheRestCounted() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        for (int i = 0; i < 5; i++) todos.add(todo("t" + i, "2026-11-18", null, "both")); // Wed, week 3
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 3);
        assertEquals(3, l.bars.size());
        assertEquals(2, l.hiddenAt(3, 2));
        assertEquals(0, l.hiddenAt(3, 1));
        for (CalendarLogic.Bar b : l.bars) assertTrue(b.lane < 3);
    }

    @Test
    public void overflow_hiddenMultiDayCountsOnEachOfItsDays() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        for (int i = 0; i < 3; i++) todos.add(todo("a" + i, "2026-11-16", "2026-11-18", "both")); // Mon-Wed
        todos.add(todo("late", "2026-11-17", "2026-11-19", "wife")); // Tue-Thu: fourth lane
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 3);
        assertTrue(barsOf(l, "late").isEmpty());
        assertEquals(0, l.hiddenAt(3, 0));
        assertEquals(1, l.hiddenAt(3, 1));
        assertEquals(1, l.hiddenAt(3, 2));
        assertEquals(1, l.hiddenAt(3, 3));
    }

    @Test
    public void overflow_fewerLanesOnASmallWidget() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-11-14");
        List<Snapshot.Todo> todos = new ArrayList<>();
        for (int i = 0; i < 3; i++) todos.add(todo("t" + i, "2026-11-18", null, "both"));
        CalendarLogic.Layout l = CalendarLogic.layout(m, todos, 1);
        assertEquals(1, l.bars.size());
        assertEquals(2, l.hiddenAt(3, 2));
    }

    // ---------- painter sizing and colours ----------

    @Test
    public void painter_threeLanesOnA4x4AndFewerWhenSmall() {
        // 300 x 300 dp bitmap at 3x, six rows: about 47 dp a row -> 3 lanes.
        assertEquals(3, CalendarPainter.lanesFor(900, 6, 3f));
        // 150 dp tall, six rows: about 22 dp a row -> 1 lane.
        assertEquals(1, CalendarPainter.lanesFor(450, 6, 3f));
    }

    @Test
    public void painter_coloursMatchTheAppMonthView() {
        assertEquals(0xFFFFFFFF, CalendarPainter.fade(0xFF000000, 1f));
        assertEquals(0xFF000000, CalendarPainter.fade(0xFF000000, 0f));
        assertEquals(0xFF808080, CalendarPainter.fade(0xFF000000, 0.5f));
        assertEquals(0xFFFBDFD3, CalendarPainter.barBg("wife"));
        assertEquals(0xFF8F4128, CalendarPainter.barInk("wife"));
        assertEquals(0xFFD8EADF, CalendarPainter.barBg("husband"));
        assertEquals(0xFF2D5A43, CalendarPainter.barInk("husband"));
        assertEquals(0xFFD7E8F6, CalendarPainter.barBg("both"));
        assertEquals(0xFF2C5A84, CalendarPainter.barInk("both"));
        assertEquals(CalendarPainter.BOTH_BG, CalendarPainter.barBg(null));
        assertEquals(CalendarPainter.SUNDAY, CalendarPainter.weekdayInk(6, 0));
        assertEquals(CalendarPainter.SATURDAY, CalendarPainter.weekdayInk(5, 0));
        assertEquals(7, CalendarPainter.weekdayInk(0, 7));
    }

    @Test
    public void routinesNeverReachTheCalendar() {
        // Routines live in Snapshot.routines; the calendar only reads Snapshot.todos.
        Snapshot s = new Snapshot();
        s.routines.add(new Snapshot.Routine("r", "dishes", "both", null, 1, true));
        CalendarLogic.Layout l = CalendarLogic.layout(CalendarLogic.monthOf("2026-11-14"), s.todos, 3);
        assertTrue(l.bars.isEmpty());
        assertNull(WidgetLogic.endOf(null, null));
    }
}
