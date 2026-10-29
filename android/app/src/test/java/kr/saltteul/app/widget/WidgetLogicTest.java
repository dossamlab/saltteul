package kr.saltteul.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class WidgetLogicTest {

    private static long at(String isoUtc) {
        return Instant.parse(isoUtc).toEpochMilli();
    }

    // ---------- household day ----------

    @Test
    public void householdDay_0230KstCountsAsPreviousDay() {
        // 2026-10-28 02:30 KST = 2026-10-27 17:30 UTC
        assertEquals("2026-10-27", WidgetLogic.householdDate(at("2026-10-27T17:30:00Z")));
        assertEquals("2026-10-28", WidgetLogic.seoulDate(at("2026-10-27T17:30:00Z")));
    }

    @Test
    public void householdDay_0400KstStartsNewDay() {
        // 04:00 KST = 19:00 UTC the day before
        assertEquals("2026-10-28", WidgetLogic.householdDate(at("2026-10-27T19:00:00Z")));
        // 03:59:59 KST is still the previous household day
        assertEquals("2026-10-27", WidgetLogic.householdDate(at("2026-10-27T18:59:59Z")));
    }

    @Test
    public void householdDay_crossesYearAndMonth() {
        // 2027-01-01 01:00 KST -> household day 2026-12-31
        assertEquals("2026-12-31", WidgetLogic.householdDate(at("2026-12-31T16:00:00Z")));
        // 2028-03-01 03:00 KST -> 2028-02-29 (leap year)
        assertEquals("2028-02-29", WidgetLogic.householdDate(at("2028-02-29T18:00:00Z")));
    }

    @Test
    public void seoulTime_formatsHoursAndMinutes() {
        assertEquals("02:30", WidgetLogic.seoulTime(at("2026-10-27T17:30:00Z")));
        assertEquals("00:00", WidgetLogic.seoulTime(at("2026-10-27T15:00:00Z")));
    }

    @Test
    public void calendarArithmetic_matchesJavaTime() {
        LocalDate d = LocalDate.of(1999, 12, 25);
        for (int i = 0; i < 12000; i += 7) {
            LocalDate x = d.plusDays(i);
            String ymd = x.toString();
            assertEquals(x.toEpochDay(), WidgetLogic.epochDay(ymd));
            assertEquals(ymd, WidgetLogic.fromEpochDay(x.toEpochDay()));
            assertEquals(x.getDayOfWeek().getValue() % 7, WidgetLogic.weekdayOf(ymd));
        }
        assertEquals("2026-11-01", WidgetLogic.addDays("2026-10-28", 4));
        assertEquals(-3, WidgetLogic.diffDays("2026-03-01", "2026-02-26"));
        assertEquals(3, WidgetLogic.weekdayOf("2026-10-28")); // Wednesday
        assertTrue(WidgetLogic.isValidYmd(2028, 2, 29));
        assertFalse(WidgetLogic.isValidYmd(2026, 2, 29));
    }

    @Test
    public void nextRollover_isNext0401Kst() {
        // 2026-10-28 02:30 KST -> same calendar day 04:01 KST (= 10-27 19:01 UTC)
        assertEquals(at("2026-10-27T19:01:00Z"), WidgetLogic.nextRolloverMillis(at("2026-10-27T17:30:00Z")));
        // exactly 04:01 KST -> next day
        assertEquals(at("2026-10-28T19:01:00Z"), WidgetLogic.nextRolloverMillis(at("2026-10-27T19:01:00Z")));
        // 23:00 KST -> next morning
        assertEquals(at("2026-10-28T19:01:00Z"), WidgetLogic.nextRolloverMillis(at("2026-10-28T14:00:00Z")));
    }

    // ---------- routines ----------

    private static Snapshot.Routine routine(String id, int[] weekdays, double order, boolean active) {
        return new Snapshot.Routine(id, id, "both", weekdays, order, active);
    }

    @Test
    public void routines_weekdayFilterAndOrder() {
        List<Snapshot.Routine> all = Arrays.asList(
                routine("recycle", new int[] {2, 4, 0}, 3, true), // Tue, Thu, Sun
                routine("dishes", null, 2, true),
                routine("plants", new int[] {}, 1, true),
                routine("off", null, 0, false));
        // 2026-10-27 is Tuesday
        List<Snapshot.Routine> tue = WidgetLogic.routinesForDay(all, "2026-10-27");
        assertEquals(Arrays.asList("plants", "dishes", "recycle"), ids(tue));
        // 2026-10-28 is Wednesday: recycling does not show
        List<Snapshot.Routine> wed = WidgetLogic.routinesForDay(all, "2026-10-28");
        assertEquals(Arrays.asList("plants", "dishes"), ids(wed));
    }

    private static List<String> ids(List<Snapshot.Routine> rs) {
        List<String> out = new ArrayList<>();
        for (Snapshot.Routine r : rs) out.add(r.id);
        return out;
    }

    @Test
    public void routines_doneOnlyForThatDay() {
        Snapshot s = new Snapshot();
        s.routines.add(routine("dishes", null, 1, true));
        s.routineLogIds.add("dishes_2026-10-27");
        assertTrue(WidgetLogic.isRoutineDone(s, "dishes", "2026-10-27"));
        assertEquals(0, WidgetLogic.openRoutines(s, "2026-10-27").size());
        // After 04:00 the household day changes and the routine is open again.
        assertEquals(1, WidgetLogic.openRoutines(s, "2026-10-28").size());
    }

    // ---------- anniversaries ----------

    @Test
    public void anniversary_nextOccurrence() {
        assertEquals("2026-12-24", WidgetLogic.nextOccurrence("2018-12-24", "2026-10-28"));
        assertEquals("2027-03-01", WidgetLogic.nextOccurrence("2018-03-01", "2026-10-28"));
        assertEquals("2026-10-28", WidgetLogic.nextOccurrence("1990-10-28", "2026-10-28"));
    }

    @Test
    public void anniversary_feb29FallsOnFeb28InCommonYears() {
        assertEquals("2026-02-28", WidgetLogic.nextOccurrence("2000-02-29", "2026-01-10"));
        assertEquals("2027-02-28", WidgetLogic.nextOccurrence("2000-02-29", "2026-03-01"));
        assertEquals("2028-02-29", WidgetLogic.nextOccurrence("2000-02-29", "2028-01-10"));
    }

    @Test
    public void anniversary_nearestSkipsTogether() {
        List<Snapshot.Anniversary> list = Arrays.asList(
                new Snapshot.Anniversary("t", "together", "together", "2015-10-29"),
                new Snapshot.Anniversary("w", "wedding", "wedding", "2018-11-03"),
                new Snapshot.Anniversary("b", "birthday", "birthday", "1990-12-01"));
        WidgetLogic.Upcoming u = WidgetLogic.nearestAnniversary(list, "2026-10-28");
        assertNotNull(u);
        assertEquals("wedding", u.title);
        assertEquals(6, u.daysLeft);
        assertEquals("D-6", WidgetLogic.dDayLabel(u.daysLeft));
        assertEquals("D-day", WidgetLogic.dDayLabel(0));
        assertNull(WidgetLogic.nearestAnniversary(new ArrayList<Snapshot.Anniversary>(), "2026-10-28"));
    }

    // ---------- rows ----------

    private static Snapshot sample() {
        Snapshot s = new Snapshot();
        s.fetchedAt = at("2026-10-28T00:00:00Z");
        s.uid = "u1";
        s.todos.add(new Snapshot.Todo("a", "untimed", "2026-10-28", null, "both", "manual"));
        s.todos.add(new Snapshot.Todo("b", "morning", "2026-10-28", "08:00", "wife", "calendar"));
        s.todos.add(new Snapshot.Todo("c", "yesterday", "2026-10-27", null, "husband", "manual"));
        s.todos.add(new Snapshot.Todo("k1", "gym clothes", "2026-10-30", "09:00", "both", "kidsnote"));
        s.todos.add(new Snapshot.Todo("k0", "field trip", "2026-10-26", null, "both", "kidsnote"));
        s.routines.add(routine("r1", null, 1, true));
        s.routines.add(routine("r2", null, 2, true));
        s.routines.add(routine("r3", null, 3, true));
        s.routineLogIds.add("r2_2026-10-28");
        s.shopping.add(new Snapshot.Shop("s2", "milk", null, 20));
        s.shopping.add(new Snapshot.Shop("s1", "filter", "c1", 10));
        return s;
    }

    @Test
    public void rows_todoWidgetCombinesTodosAndRoutinesMaxFour() {
        Snapshot s = sample();
        List<WidgetLogic.Row> rows = WidgetLogic.buildRows(s, WidgetLogic.KIND_TODO, "2026-10-28");
        assertEquals(4, rows.size());
        assertEquals("b", rows.get(0).id); // timed todo first
        assertEquals("a", rows.get(1).id);
        assertEquals("r1", rows.get(2).id);
        assertEquals("r3", rows.get(3).id); // r2 is done
        assertEquals(4, WidgetLogic.todoWidgetLeft(s, "2026-10-28"));
    }

    @Test
    public void rows_dashboardShowsAtMostThreeTodayTodos() {
        Snapshot s = sample();
        for (int i = 0; i < 5; i++) s.todos.add(new Snapshot.Todo("x" + i, "t" + i, "2026-10-28", null, "both", "manual"));
        List<WidgetLogic.Row> rows = WidgetLogic.buildRows(s, WidgetLogic.KIND_DASHBOARD, "2026-10-28");
        assertEquals(3, rows.size());
        for (WidgetLogic.Row r : rows) assertEquals(WidgetLogic.TARGET_TODO, r.target);
    }

    @Test
    public void rows_tabletHasSections() {
        Snapshot s = sample();
        List<WidgetLogic.Row> rows = WidgetLogic.buildRows(s, WidgetLogic.KIND_TABLET, "2026-10-28");
        List<String> keys = new ArrayList<>();
        for (WidgetLogic.Row r : rows) keys.add(r.type == WidgetLogic.Row.SECTION ? "#" + r.key : r.id);
        assertEquals(Arrays.asList(
                "#today", "b", "a",
                "#routine", "r1", "r2", "r3",
                "#kidsnote", "k1",
                "#shopping", "s1", "s2"), keys);
        assertTrue(rows.get(5).checked); // r2 done today
    }

    @Test
    public void rows_signedOutHasNoRows() {
        assertEquals(0, WidgetLogic.buildRows(Snapshot.signedOut(0), WidgetLogic.KIND_TABLET, "2026-10-28").size());
        assertEquals(0, WidgetLogic.buildRows(null, WidgetLogic.KIND_TODO, "2026-10-28").size());
    }

    @Test
    public void toggle_optimisticUpdate() {
        Snapshot s = sample();
        WidgetLogic.applyToggle(s, WidgetLogic.TARGET_TODO, "b", false, "2026-10-28");
        WidgetLogic.applyToggle(s, WidgetLogic.TARGET_ROUTINE, "r1", false, "2026-10-28");
        WidgetLogic.applyToggle(s, WidgetLogic.TARGET_ROUTINE, "r2", true, "2026-10-28");
        WidgetLogic.applyToggle(s, WidgetLogic.TARGET_SHOPPING, "s1", false, "2026-10-28");
        assertEquals(1, WidgetLogic.openTodayTodos(s, "2026-10-28").size());
        assertTrue(WidgetLogic.isRoutineDone(s, "r1", "2026-10-28"));
        assertFalse(WidgetLogic.isRoutineDone(s, "r2", "2026-10-28"));
        assertEquals(1, WidgetLogic.openShopping(s).size());
    }

    @Test
    public void purchasesAfterBuy_matchesWebApp() {
        assertEquals(Arrays.asList("2026-09-01", "2026-10-28"),
                WidgetLogic.purchasesAfterBuy(Arrays.asList("2026-10-28", "2026-09-01"), "2026-10-28", true));
        assertEquals(Arrays.asList("2026-09-01"),
                WidgetLogic.purchasesAfterBuy(Arrays.asList("2026-09-01", "2026-10-28"), "2026-10-28", false));
    }

    // ---------- formatting ----------

    @Test
    public void fillTemplate_andWeatherLabel() {
        assertEquals("10/28 (W)", WidgetLogic.fill("{m}/{d} ({w})", "m", "10", "d", "28", "w", "W"));
        assertEquals("", WidgetLogic.weatherLabel(null));
        assertEquals("8° / 17° · 60%", WidgetLogic.weatherLabel(new Snapshot.Weather("2026-10-28", 7.6, 17.2, 60.0)));
        assertEquals("30%", WidgetLogic.weatherLabel(new Snapshot.Weather("2026-10-28", null, null, 30.0)));
    }

    // ---------- snapshot JSON ----------

    @Test
    public void snapshot_jsonRoundTrip() {
        Snapshot s = sample();
        s.headline = "headline";
        s.anniversaries.add(new Snapshot.Anniversary("w", "wedding", "wedding", "2018-11-03"));
        s.weather.add(new Snapshot.Weather("2026-10-28", 7.5, null, 60.0));
        s.memberNames.put("wife", "Jieun");
        s.todos.get(0).done = true;
        s.shopping.get(0).bought = true;

        Snapshot r = Snapshot.fromJson(s.toJson());
        assertNotNull(r);
        assertEquals(Snapshot.STATUS_OK, r.status);
        assertEquals(s.fetchedAt, r.fetchedAt);
        assertEquals("u1", r.uid);
        assertEquals("headline", r.headline);
        assertEquals(s.todos.size(), r.todos.size());
        Snapshot.Todo b = r.todos.get(1);
        assertEquals("b", b.id);
        assertEquals("08:00", b.time);
        assertEquals("wife", b.owner);
        assertEquals("calendar", b.source);
        assertNull(r.todos.get(0).time);
        assertTrue(r.todos.get(0).done);
        assertEquals("c1", r.shopping.get(1).consumableId);
        assertNull(r.shopping.get(0).consumableId);
        assertTrue(r.shopping.get(0).bought);
        assertEquals(10, r.shopping.get(1).createdAt);
        assertNull(r.routines.get(0).weekdays);
        assertEquals(2.0, r.routines.get(1).order, 0);
        assertEquals(Arrays.asList("r2_2026-10-28"), r.routineLogIds);
        assertEquals("2018-11-03", r.anniversaries.get(0).date);
        assertEquals(7.5, r.weather.get(0).minC, 0);
        assertNull(r.weather.get(0).maxC);
        assertEquals("Jieun", r.memberNames.get("wife"));

        // Same output twice = nothing lost or reordered.
        assertEquals(s.toJson(), r.toJson());
    }

    @Test
    public void snapshot_weekdaysAndSignedOutRoundTrip() {
        Snapshot s = Snapshot.signedOut(123);
        s.routines.add(routine("x", new int[] {0, 6}, 1, false));
        Snapshot r = Snapshot.fromJson(s.toJson());
        assertNotNull(r);
        assertEquals(Snapshot.STATUS_SIGNED_OUT, r.status);
        assertEquals(123, r.fetchedAt);
        assertTrue(Arrays.equals(new int[] {0, 6}, r.routines.get(0).weekdays));
        assertFalse(r.routines.get(0).active);
    }

    @Test
    public void snapshot_badJsonIsNull() {
        assertNull(Snapshot.fromJson(null));
        assertNull(Snapshot.fromJson(""));
        assertNull(Snapshot.fromJson("{not json"));
    }
}
