package kr.saltteul.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** Runs CalendarPainter against a pen that records what it draws (android.graphics is not available on the JVM). */
public class CalendarPainterTest {

    static final class RecordingPen implements CalendarPainter.Pen {
        final List<String> texts = new ArrayList<>();
        final List<Integer> textColors = new ArrayList<>();
        final List<Integer> roundRectColors = new ArrayList<>();
        int circles;
        int depth;
        int maxDepth;

        @Override
        public void fillRect(float l, float t, float r, float b, int argb) {
            assertTrue(r >= l && b >= t);
        }

        @Override
        public void fillRoundRect(float l, float t, float r, float b, float radius, int argb) {
            assertTrue(r > l && b > t);
            roundRectColors.add(argb);
        }

        @Override
        public void fillCircle(float cx, float cy, float radius, int argb) {
            circles++;
        }

        @Override
        public float textWidth(String s, float size, boolean bold) {
            return s.length() * size * 0.6f;
        }

        @Override
        public void text(String s, float x, float baseline, float size, int argb, boolean bold) {
            texts.add(s);
            textColors.add(argb);
        }

        @Override
        public void save() {
            depth++;
            maxDepth = Math.max(maxDepth, depth);
        }

        @Override
        public void clip(float l, float t, float r, float b) {
            assertTrue(depth > 0);
        }

        @Override
        public void restore() {
            depth--;
        }
    }

    private static final String[] WEEKDAYS = {"Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"};

    private static Snapshot.Todo todo(String id, String date, String end, String owner, boolean done) {
        Snapshot.Todo t = new Snapshot.Todo(id, "title " + id, date, null, owner, "manual");
        t.endDate = end;
        t.done = done;
        return t;
    }

    @Test
    public void paintsWeekdaysDatesTodayBarsAndOverflow() {
        String today = "2026-11-14";
        CalendarLogic.Month m = CalendarLogic.monthOf(today);
        List<Snapshot.Todo> todos = new ArrayList<>();
        todos.add(todo("trip", "2026-11-06", "2026-11-10", "husband", false)); // two segments
        for (int i = 0; i < 5; i++) todos.add(todo("busy" + i, "2026-11-18", null, "wife", false)); // 3 + "+2"
        todos.add(todo("done", "2026-11-03", null, "both", true));
        float dp = 3f;
        float w = 304 * dp;
        float h = 350 * dp;
        int lanes = CalendarPainter.lanesFor(h, m.weeks, dp);
        CalendarLogic.Layout layout = CalendarLogic.layout(m, todos, lanes);
        RecordingPen pen = new RecordingPen();
        CalendarPainter.paint(pen, w, h, dp, layout, lanes, today, WEEKDAYS);

        assertEquals(3, lanes);
        assertEquals(0, pen.depth);
        for (String wd : WEEKDAYS) assertTrue(pen.texts.contains(wd));
        // 35 day numbers (five weeks), the today circle, "+2" on the busy Wednesday.
        assertEquals(1, pen.circles);
        assertTrue(pen.texts.contains("+2"));
        // Bars: 2 trip segments + 3 busy + 1 done; each has its title.
        assertEquals(6, pen.roundRectColors.size());
        assertTrue(pen.texts.contains("title trip"));
        assertTrue(pen.roundRectColors.contains(CalendarPainter.HUSBAND_BG));
        assertTrue(pen.roundRectColors.contains(CalendarPainter.WIFE_BG));
        // The done bar is faded, not the plain colour.
        assertTrue(pen.roundRectColors.contains(CalendarPainter.fade(CalendarPainter.BOTH_BG, CalendarPainter.DONE_FADE)));
        assertTrue(!pen.roundRectColors.contains(CalendarPainter.BOTH_BG));
        // Sunday header in pale red, Saturday in pale blue.
        assertEquals(CalendarPainter.SUNDAY, (int) pen.textColors.get(pen.texts.indexOf("Su")));
        assertEquals(CalendarPainter.SATURDAY, (int) pen.textColors.get(pen.texts.indexOf("Sa")));
        // Days of the next month are faded: Dec 1 (week 4, Tuesday) is drawn in a lighter ink.
        int dec1 = pen.texts.lastIndexOf("1");
        assertEquals(CalendarPainter.fade(CalendarPainter.INK, 0.6f), (int) pen.textColors.get(dec1));
    }

    @Test
    public void tinyBitmapStillPaintsWithoutTitles() {
        CalendarLogic.Month m = CalendarLogic.monthOf("2026-08-01");
        List<Snapshot.Todo> todos = new ArrayList<>();
        todos.add(todo("a", "2026-08-03", null, "both", false));
        float dp = 1f;
        int lanes = CalendarPainter.lanesFor(120, m.weeks, dp);
        RecordingPen pen = new RecordingPen();
        CalendarPainter.paint(pen, 150, 120, dp, CalendarLogic.layout(m, todos, lanes), lanes, "2026-08-01", WEEKDAYS);
        assertEquals(1, lanes);
        assertEquals(1, pen.roundRectColors.size());
        assertTrue(!pen.texts.contains("title a"));
    }
}
