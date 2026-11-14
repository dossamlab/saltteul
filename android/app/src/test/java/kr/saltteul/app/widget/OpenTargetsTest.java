package kr.saltteul.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class OpenTargetsTest {

    private static final List<String> ALL = Arrays.asList(OpenTargets.CAPTURE, OpenTargets.CAPTURE_MIC,
            OpenTargets.TODOS_MONTH, OpenTargets.TODOS, OpenTargets.SHOPPING, OpenTargets.trip("Ab12_x-Y"));

    @Test
    public void contractNamesMatchTheDesign() {
        assertEquals("kr.saltteul.app.OPEN", OpenTargets.EXTRA_OPEN);
        assertEquals(Arrays.asList("capture", "capture-mic", "todos-month", "todos", "shopping", "trip:Ab12_x-Y"), ALL);
    }

    @Test
    public void onlyKnownTargetsAreValid() {
        for (String t : ALL) assertTrue(t, OpenTargets.isValid(t));
        assertFalse(OpenTargets.isValid(null));
        assertFalse(OpenTargets.isValid(""));
        assertFalse(OpenTargets.isValid("trip:"));
        assertFalse(OpenTargets.isValid("trip:a'b"));
        assertFalse(OpenTargets.isValid("trip:a\\b"));
        assertFalse(OpenTargets.isValid("settings"));
        assertFalse(OpenTargets.isValid("todos');alert(1);//"));
    }

    @Test
    public void captureTargets() {
        assertTrue(OpenTargets.isCapture("capture"));
        assertTrue(OpenTargets.isCapture("capture-mic"));
        assertFalse(OpenTargets.isCapture("todos"));
        assertFalse(OpenTargets.isCapture(null));
    }

    @Test
    public void everyTargetKindHasItsOwnRequestCode() {
        Set<Integer> codes = new HashSet<>();
        for (String t : ALL) codes.add(OpenTargets.requestCode(t));
        assertEquals(ALL.size(), codes.size());
        assertEquals(OpenTargets.requestCode("trip:a"), OpenTargets.requestCode("trip:b"));
    }

    @Test
    public void jsStringEscapesAnythingUnexpected() {
        assertEquals("'trip:Ab12_x-Y'", OpenTargets.jsString("trip:Ab12_x-Y"));
        assertEquals("'a\\u0027b\\u005cc\\u2028'", OpenTargets.jsString("a'b\\c "));
    }

    @Test
    public void deliverScriptCallsOpenOrLeavesItPending() {
        String js = OpenTargets.deliverScript("capture-mic");
        assertEquals("(function(){var t='capture-mic';if(typeof window.saltteulOpen==='function'){window.saltteulOpen(t);}"
                + "else{window.__saltteulPendingOpen=t;}})();", js);
    }
}
