package kr.saltteul.app.widget;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The app/widget contract (design 2026-11-14 section 6): a widget opens MainActivity with the extra EXTRA_OPEN set to
 * one of these targets, and MainActivity hands it to the web page as window.saltteulOpen(target). Pure Java.
 */
public final class OpenTargets {

    private OpenTargets() {}

    public static final String EXTRA_OPEN = "kr.saltteul.app.OPEN";
    /** Action of the widget launch intents; it differs from MAIN so a running task gets onNewIntent. */
    public static final String ACTION_OPEN = "kr.saltteul.app.action.OPEN";

    public static final String CAPTURE = "capture";
    public static final String CAPTURE_MIC = "capture-mic";
    public static final String TODOS_MONTH = "todos-month";
    public static final String TODOS = "todos";
    public static final String SHOPPING = "shopping";
    public static final String TRIP_PREFIX = "trip:";

    /** Firestore auto ids are 20 letters and digits; allow the usual id characters, nothing that needs escaping. */
    private static final Pattern VALID = Pattern.compile(
            "^(capture|capture-mic|todos-month|todos|shopping|trip:[A-Za-z0-9_-]{1,128})$");

    public static String trip(String id) {
        return TRIP_PREFIX + id;
    }

    /** Only the targets above; anything else (MainActivity is exported, so any app could send one) is dropped. */
    public static boolean isValid(String target) {
        return target != null && VALID.matcher(target).matches();
    }

    /** The quick-add window: after it is saved or cancelled the web calls SaltteulNative.captureDone(). */
    public static boolean isCapture(String target) {
        return CAPTURE.equals(target) || CAPTURE_MIC.equals(target);
    }

    /** Distinct PendingIntent request codes so the widget buttons never share (and overwrite) one PendingIntent. */
    public static int requestCode(String target) {
        if (CAPTURE.equals(target)) return 601;
        if (CAPTURE_MIC.equals(target)) return 602;
        if (TODOS_MONTH.equals(target)) return 603;
        if (TODOS.equals(target)) return 604;
        if (SHOPPING.equals(target)) return 605;
        return 606; // trip:<id>; FLAG_UPDATE_CURRENT carries the current id
    }

    /** A JavaScript string literal for target. Valid targets have no quotes or backslashes, but escape anyway. */
    public static String jsString(String target) {
        StringBuilder b = new StringBuilder("'");
        for (int i = 0; i < target.length(); i++) {
            char ch = target.charAt(i);
            if (ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_'
                    || ch == ':') {
                b.append(ch);
            } else {
                b.append(String.format(Locale.US, "\\u%04x", (int) ch));
            }
        }
        return b.append('\'').toString();
    }

    /**
     * Calls window.saltteulOpen(target) when the web app has set it up, otherwise leaves the target in
     * window.__saltteulPendingOpen for the web app to pick up (and clear) when it starts.
     */
    public static String deliverScript(String target) {
        String t = jsString(target);
        return "(function(){var t=" + t + ";if(typeof window.saltteulOpen==='function'){window.saltteulOpen(t);}"
                + "else{window.__saltteulPendingOpen=t;}})();";
    }
}
