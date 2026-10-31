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

    // ---------- pantry (shared/pantry.ts) ----------

    private static Snapshot.Pantry pantry(String id, String name, int qty, double minQty, String expiry) {
        return new Snapshot.Pantry(id, name, "pack", qty, minQty, expiry);
    }

    private static List<String> pantryIds(List<Snapshot.Pantry> ps) {
        List<String> out = new ArrayList<>();
        for (Snapshot.Pantry p : ps) out.add(p.id);
        return out;
    }

    @Test
    public void pantry_isLowAtOrBelowMin() {
        assertTrue(WidgetLogic.isLow(pantry("a", "a", 2, 2, null)));
        assertTrue(WidgetLogic.isLow(pantry("a", "a", 0, 0, null)));
        assertFalse(WidgetLogic.isLow(pantry("a", "a", 3, 2, null)));
    }

    @Test
    public void pantry_expiresSoonWithinSevenDaysOrPast() {
        String today = "2026-10-28";
        assertEquals(Integer.valueOf(7), WidgetLogic.daysToExpiry(pantry("a", "a", 5, 1, "2026-11-04"), today));
        assertTrue(WidgetLogic.expiresSoon(pantry("a", "a", 5, 1, "2026-11-04"), today)); // 7 days
        assertFalse(WidgetLogic.expiresSoon(pantry("a", "a", 5, 1, "2026-11-05"), today)); // 8 days
        assertTrue(WidgetLogic.expiresSoon(pantry("a", "a", 5, 1, "2026-10-28"), today)); // today
        assertTrue(WidgetLogic.expiresSoon(pantry("a", "a", 5, 1, "2026-10-20"), today)); // past
        assertEquals(Integer.valueOf(-8), WidgetLogic.daysToExpiry(pantry("a", "a", 5, 1, "2026-10-20"), today));
        assertNull(WidgetLogic.daysToExpiry(pantry("a", "a", 5, 1, null), today));
        assertFalse(WidgetLogic.expiresSoon(pantry("a", "a", 5, 1, null), today));
    }

    @Test
    public void pantry_expiredOnlyAfterTheDate() {
        String today = "2026-10-28";
        assertTrue(WidgetLogic.isExpired(pantry("a", "a", 5, 1, "2026-10-27"), today));
        assertFalse(WidgetLogic.isExpired(pantry("a", "a", 5, 1, "2026-10-28"), today)); // today: 0 days
        assertFalse(WidgetLogic.isExpired(pantry("a", "a", 5, 1, "2026-11-04"), today));
        assertFalse(WidgetLogic.isExpired(pantry("a", "a", 5, 1, null), today));

        Snapshot s = new Snapshot();
        s.pantry.add(new Snapshot.Pantry("past", "a", "", 5, 1, "2026-10-20"));
        s.pantry.add(new Snapshot.Pantry("today", "b", "", 5, 1, "2026-10-28"));
        s.pantry.add(new Snapshot.Pantry("week", "c", "", 5, 1, "2026-11-04"));
        List<WidgetLogic.Row> rows = WidgetLogic.buildRows(s, WidgetLogic.KIND_PANTRY, today);
        assertEquals("past", rows.get(0).id);
        assertTrue(rows.get(0).expired);
        assertEquals("today", rows.get(1).id);
        assertFalse(rows.get(1).expired);
        assertEquals(Integer.valueOf(0), rows.get(1).expiryDays);
        assertFalse(rows.get(2).expired);
        assertEquals(Integer.valueOf(7), rows.get(2).expiryDays);
        // The tablet section uses the same rows.
        for (WidgetLogic.Row r : WidgetLogic.buildRows(s, WidgetLogic.KIND_TABLET, today)) {
            if ("past".equals(r.id)) assertTrue(r.expired);
        }
    }

    @Test
    public void pantry_expiryUsesHouseholdDay() {
        // 2026-11-05 02:00 KST is still household day 11-04, so an 11-11 expiry is 7 days away.
        String day = WidgetLogic.householdDate(at("2026-11-04T17:00:00Z"));
        assertEquals("2026-11-04", day);
        assertTrue(WidgetLogic.expiresSoon(pantry("a", "a", 5, 1, "2026-11-11"), day));
    }

    @Test
    public void pantry_sortLowThenExpiringThenKoreanName() {
        String today = "2026-10-28";
        List<Snapshot.Pantry> list = Arrays.asList(
                pantry("water", "물", 10, 2, null),               // mul: ok
                pantry("rice", "햇반", 1, 2, null),           // haetban: low
                pantry("milk", "우유", 4, 1, "2026-10-30"),   // uyu: expiring
                pantry("ramen", "라면", 0, 1, "2026-10-29"),  // ramyeon: low and expiring -> low rank
                pantry("egg", "계란", 10, 2, "2026-12-01"),   // gyeran: ok
                pantry("tissue", "가제품", 3, 1, null)); // ok, sorts first by name
        assertEquals(Arrays.asList("ramen", "rice", "milk", "tissue", "egg", "water"),
                pantryIds(WidgetLogic.sortPantry(list, today)));
    }

    @Test
    public void pantry_afterUseNeverBelowZero() {
        assertEquals(2, WidgetLogic.pantryAfterUse(3));
        assertEquals(0, WidgetLogic.pantryAfterUse(1));
        assertEquals(0, WidgetLogic.pantryAfterUse(0));
    }

    @Test
    public void pantry_shoppingTickAddsAndUntickTakesBack() {
        assertEquals(12, WidgetLogic.pantryAmount(12));
        assertEquals(3, WidgetLogic.pantryAmount(2.6));
        assertEquals(0, WidgetLogic.pantryAmount(-1));
        // bought: 'buy' adds restockQty
        assertEquals(14, WidgetLogic.pantryAfterShopping(2, 12, true));
        assertEquals(12, WidgetLogic.pantryAfterShopping(0, 12, true));
        // unticked: 'use' takes it back off, never below zero
        assertEquals(2, WidgetLogic.pantryAfterShopping(14, 12, false));
        assertEquals(0, WidgetLogic.pantryAfterShopping(5, 12, false));
    }

    @Test
    public void shopping_pantryIdRoundTripsToRow() {
        Snapshot s = sample();
        s.shopping.get(0).pantryId = "p1";
        Snapshot r = Snapshot.fromJson(s.toJson());
        assertNotNull(r);
        assertEquals("p1", r.shopping.get(0).pantryId);
        assertNull(r.shopping.get(1).pantryId);
        assertEquals(s.toJson(), r.toJson());
        for (WidgetLogic.Row row : WidgetLogic.buildRows(r, WidgetLogic.KIND_TABLET, "2026-10-28")) {
            if ("s2".equals(row.id)) assertEquals("p1", row.pantryId);
            if ("s1".equals(row.id)) assertNull(row.pantryId);
        }
    }

    @Test
    public void pantry_unitDefaultsToGae() {
        assertEquals("개", WidgetLogic.pantryUnit(null));
        assertEquals("개", WidgetLogic.pantryUnit("  "));
        assertEquals("pack", WidgetLogic.pantryUnit(" pack "));
    }

    @Test
    public void pantry_optimisticUseStopsAtZero() {
        Snapshot s = sample();
        s.pantry.add(pantry("p1", "p1", 1, 0, null));
        assertTrue(WidgetLogic.applyPantryUse(s, "p1"));
        assertEquals(0, s.pantry.get(0).qty);
        assertFalse(WidgetLogic.applyPantryUse(s, "p1"));
        assertEquals(0, s.pantry.get(0).qty);
        assertFalse(WidgetLogic.applyPantryUse(s, "missing"));
        s.pantry.get(0).qty = 4;
        WidgetLogic.applyToggle(s, WidgetLogic.TARGET_PANTRY, "p1", false, "2026-10-28");
        assertEquals(3, s.pantry.get(0).qty);
    }

    @Test
    public void rows_pantryWidgetListsEverythingSorted() {
        Snapshot s = sample();
        s.pantry.add(new Snapshot.Pantry("ok", "b", "", 5, 1, null));
        s.pantry.add(new Snapshot.Pantry("low", "c", "pack", 1, 1, "2026-10-26"));
        s.pantry.add(new Snapshot.Pantry("soon", "a", "bag", 9, 1, "2026-10-31"));
        List<WidgetLogic.Row> rows = WidgetLogic.buildRows(s, WidgetLogic.KIND_PANTRY, "2026-10-28");
        assertEquals(3, rows.size());
        WidgetLogic.Row low = rows.get(0);
        assertEquals("low", low.id);
        assertEquals(WidgetLogic.TARGET_PANTRY, low.target);
        assertTrue(low.low);
        assertEquals(Integer.valueOf(-2), low.expiryDays);
        assertEquals(1, low.qty);
        WidgetLogic.Row soon = rows.get(1);
        assertEquals("soon", soon.id);
        assertFalse(soon.low);
        assertEquals(Integer.valueOf(3), soon.expiryDays);
        assertEquals("bag", soon.unit);
        WidgetLogic.Row ok = rows.get(2);
        assertNull(ok.expiryDays);
        assertEquals("개", ok.unit);
        // No pantry items: no rows (the widget shows widget_pantryEmpty).
        assertEquals(0, WidgetLogic.buildRows(sample(), WidgetLogic.KIND_PANTRY, "2026-10-28").size());
        assertEquals(0, WidgetLogic.buildRows(Snapshot.signedOut(0), WidgetLogic.KIND_PANTRY, "2026-10-28").size());
    }

    @Test
    public void rows_tabletPantrySectionOnlyLowOrExpiring() {
        Snapshot s = sample();
        s.pantry.add(new Snapshot.Pantry("ok", "b", "", 5, 1, "2027-01-01"));
        s.pantry.add(new Snapshot.Pantry("low", "c", "", 0, 1, null));
        s.pantry.add(new Snapshot.Pantry("soon", "a", "", 9, 1, "2026-11-01"));
        List<WidgetLogic.Row> rows = WidgetLogic.buildRows(s, WidgetLogic.KIND_TABLET, "2026-10-28");
        List<String> keys = new ArrayList<>();
        for (WidgetLogic.Row r : rows) keys.add(r.type == WidgetLogic.Row.SECTION ? "#" + r.key : r.id);
        assertEquals(Arrays.asList(
                "#today", "b", "a",
                "#routine", "r1", "r2", "r3",
                "#kidsnote", "k1",
                "#shopping", "s1", "s2",
                "#pantry", "low", "soon"), keys);

        // Nothing low or expiring: no pantry section at all.
        Snapshot calm = sample();
        calm.pantry.add(new Snapshot.Pantry("ok", "b", "", 5, 1, null));
        for (WidgetLogic.Row r : WidgetLogic.buildRows(calm, WidgetLogic.KIND_TABLET, "2026-10-28")) {
            assertFalse(WidgetLogic.SECTION_PANTRY.equals(r.key) || WidgetLogic.TARGET_PANTRY.equals(r.target));
        }
    }

    @Test
    public void snapshot_pantryRoundTripAndOldCache() {
        Snapshot s = sample();
        s.pantry.add(new Snapshot.Pantry("p1", "rice", "pack", 3, 2, "2026-11-01"));
        s.pantry.add(new Snapshot.Pantry("p2", "tissue", null, 0, 1.5, null));
        Snapshot r = Snapshot.fromJson(s.toJson());
        assertNotNull(r);
        assertEquals(2, r.pantry.size());
        assertEquals("rice", r.pantry.get(0).name);
        assertEquals("pack", r.pantry.get(0).unit);
        assertEquals(3, r.pantry.get(0).qty);
        assertEquals(2.0, r.pantry.get(0).minQty, 0);
        assertEquals("2026-11-01", r.pantry.get(0).expiry);
        assertNull(r.pantry.get(1).unit);
        assertNull(r.pantry.get(1).expiry);
        assertEquals(1.5, r.pantry.get(1).minQty, 0);
        assertEquals(s.toJson(), r.toJson());

        // A cache saved before the pantry existed still loads, with no items.
        Snapshot old = Snapshot.fromJson("{\"v\":1,\"status\":\"ok\",\"fetchedAt\":1,\"todos\":[]}");
        assertNotNull(old);
        assertEquals(0, old.pantry.size());
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
