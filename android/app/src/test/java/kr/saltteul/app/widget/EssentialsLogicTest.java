package kr.saltteul.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class EssentialsLogicTest {

    private static final String TODAY = "2026-11-14";

    private static Snapshot.Todo prepTodo(String id, String date, String time, String... items) {
        Snapshot.Todo t = new Snapshot.Todo(id, id, date, time, "both", "kidsnote");
        t.prepItems.addAll(Arrays.asList(items));
        return t;
    }

    private static Snapshot withAll() {
        Snapshot s = new Snapshot();
        s.todos.add(prepTodo("pe", "2026-11-15", "10:00", "indoor shoes", "milk carton"));
        s.trips.add(new Snapshot.Trip("tr1", "Jeju trip", "2026-11-17", 2, 1L, 18, 42));
        s.shopping.add(new Snapshot.Shop("s1", "milk", null, 1));
        return s;
    }

    @Test
    public void prepForTomorrowComesFirst() {
        EssentialsLogic.Essential e = EssentialsLogic.choose(withAll(), TODAY);
        assertEquals(EssentialsLogic.KIND_PREP, e.kind);
        assertEquals(Arrays.asList("indoor shoes", "milk carton"), e.names);
        assertEquals(OpenTargets.TODOS, e.target());
    }

    @Test
    public void prepJoinsTodosByTimeWithoutRepeats() {
        Snapshot s = new Snapshot();
        s.todos.add(prepTodo("late", "2026-11-15", null, "crayons", "towel"));
        s.todos.add(prepTodo("early", "2026-11-15", "08:30", "towel", "hat"));
        EssentialsLogic.Essential e = EssentialsLogic.choose(s, TODAY);
        assertEquals(Arrays.asList("towel", "hat", "crayons"), e.names);
        assertEquals("towel, hat, crayons", EssentialsLogic.namesText(e.names, false));
    }

    @Test
    public void prepIgnoresDoneTodayAndEmpty() {
        Snapshot s = new Snapshot();
        Snapshot.Todo done = prepTodo("d", "2026-11-15", null, "x");
        done.done = true;
        s.todos.add(done);
        s.todos.add(prepTodo("today", TODAY, null, "y"));
        s.todos.add(prepTodo("none", "2026-11-15", null));
        assertEquals(EssentialsLogic.KIND_NONE, EssentialsLogic.choose(s, TODAY).kind);
    }

    @Test
    public void tripWithUnpackedItemsComesSecond() {
        Snapshot s = withAll();
        s.todos.clear();
        EssentialsLogic.Essential e = EssentialsLogic.choose(s, TODAY);
        assertEquals(EssentialsLogic.KIND_TRIP, e.kind);
        assertEquals("D-3", e.when);
        assertEquals(18, e.trip.packed);
        assertEquals(42, e.trip.total);
        assertEquals("trip:tr1", e.target());
    }

    @Test
    public void tripWindowIsAWeekBeforeThroughTheReturnDay() {
        assertTrue(EssentialsLogic.tripInWindow("2026-11-21", 0, TODAY)); // 7 days ahead
        assertFalse(EssentialsLogic.tripInWindow("2026-11-22", 0, TODAY)); // 8 days ahead
        assertTrue(EssentialsLogic.tripInWindow("2026-11-12", 2, TODAY)); // comes home today
        assertFalse(EssentialsLogic.tripInWindow("2026-11-12", 1, TODAY)); // came home yesterday
        assertFalse(EssentialsLogic.tripInWindow("bad", 1, TODAY));
    }

    @Test
    public void tripLabelDdayOnTheFirstDayThenOngoing() {
        Snapshot s = new Snapshot();
        s.trips.add(new Snapshot.Trip("t", "beach", TODAY, 2, 1L, 1, 5));
        assertEquals("D-day", EssentialsLogic.choose(s, TODAY).when);
        assertNull(EssentialsLogic.choose(s, "2026-11-15").when);
    }

    @Test
    public void tripSkippedWhenAllPackedOrEmptyAndSoonestWins() {
        Snapshot s = new Snapshot();
        s.trips.add(new Snapshot.Trip("packed", "a", "2026-11-15", 1, 1L, 10, 10));
        s.trips.add(new Snapshot.Trip("empty", "b", "2026-11-15", 1, 1L, 0, 0));
        s.trips.add(new Snapshot.Trip("later", "c", "2026-11-19", 1, 1L, 0, 3));
        s.trips.add(new Snapshot.Trip("sooner", "d", "2026-11-16", 1, 2L, 0, 3));
        assertEquals("sooner", EssentialsLogic.choose(s, TODAY).trip.id);
    }

    @Test
    public void shoppingComesThirdWithThreeNamesAndAnEllipsis() {
        Snapshot s = new Snapshot();
        String[] names = {"milk", "rice", "diapers", "eggs", "tofu"};
        for (int i = 0; i < names.length; i++) s.shopping.add(new Snapshot.Shop("s" + i, names[i], null, i));
        Snapshot.Shop bought = new Snapshot.Shop("b", "bought", null, -1);
        bought.bought = true;
        s.shopping.add(bought);
        EssentialsLogic.Essential e = EssentialsLogic.choose(s, TODAY);
        assertEquals(EssentialsLogic.KIND_SHOPPING, e.kind);
        assertEquals(5, e.count);
        assertTrue(e.more);
        assertEquals("milk, rice, diapers…", EssentialsLogic.namesText(e.names, e.more));
        assertEquals(OpenTargets.SHOPPING, e.target());
    }

    @Test
    public void shoppingWithoutEllipsisWhenAllNamesShow() {
        Snapshot s = new Snapshot();
        s.shopping.add(new Snapshot.Shop("s", "milk", null, 1));
        EssentialsLogic.Essential e = EssentialsLogic.choose(s, TODAY);
        assertFalse(e.more);
        assertEquals("milk", EssentialsLogic.namesText(e.names, e.more));
    }

    @Test
    public void nothingToBring() {
        EssentialsLogic.Essential e = EssentialsLogic.choose(new Snapshot(), TODAY);
        assertEquals(EssentialsLogic.KIND_NONE, e.kind);
        assertEquals(OpenTargets.TODOS, e.target());
        assertEquals(EssentialsLogic.KIND_NONE, EssentialsLogic.choose(null, TODAY).kind);
        assertEquals("", EssentialsLogic.namesText(Collections.<String>emptyList(), false));
    }

    @Test
    public void weatherHighLowAndIcon() {
        assertEquals("12° / 3°", EssentialsLogic.highLow(new Snapshot.Weather(TODAY, 3.2, 11.6, 60.0)));
        assertEquals("- / 3°", EssentialsLogic.highLow(new Snapshot.Weather(TODAY, 3.0, null, null)));
        assertNull(EssentialsLogic.highLow(new Snapshot.Weather(TODAY, null, null, 30.0)));
        assertNull(EssentialsLogic.highLow(null));
        assertEquals(EssentialsLogic.ICON_RAIN, EssentialsLogic.skyIcon("shower"));
        assertEquals(EssentialsLogic.ICON_RAIN, EssentialsLogic.skyIcon("rainsnow"));
        assertEquals(EssentialsLogic.ICON_SNOW, EssentialsLogic.skyIcon("snow"));
        assertEquals(EssentialsLogic.ICON_CLEAR, EssentialsLogic.skyIcon("clear"));
        assertEquals(EssentialsLogic.ICON_PARTLY, EssentialsLogic.skyIcon(null));
    }

    @Test
    public void packingCountsOnlyShownItems() {
        assertTrue(EssentialsLogic.isShown(1));
        assertFalse(EssentialsLogic.isShown(0));
    }
}
