package kr.saltteul.app.widget;

/**
 * Draws the month calendar (weekday row, dates, today's circle, owner bars, "+n") through Pen, so the drawing code
 * has no Android types: the widget passes a Canvas-backed pen, a JVM test can pass an AWT one and save a PNG.
 * Sizes are in dp and scaled by the density given; colours are opaque (fades are mixed with white, not alpha, so the
 * square ends of a bar never show a darker overlap).
 */
public final class CalendarPainter {

    private CalendarPainter() {}

    /** Minimal drawing surface. Text is drawn left-aligned at a baseline. */
    public interface Pen {
        void fillRect(float l, float t, float r, float b, int argb);

        void fillRoundRect(float l, float t, float r, float b, float radius, int argb);

        void fillCircle(float cx, float cy, float radius, int argb);

        float textWidth(String s, float size, boolean bold);

        void text(String s, float x, float baseline, float size, int argb, boolean bold);

        void save();

        void clip(float l, float t, float r, float b);

        void restore();
    }

    // Warm Hearth ink (res/values/widget_colors.xml) and the calendar's own pastels.
    static final int INK = 0xFF232724;
    static final int INK_2 = 0xFF646C65;
    static final int INK_3 = 0xFFA7ADA6;
    static final int LINE = 0xFFEFEDE6;
    /** Sunday and Saturday, as the app's month view (terra, #5a7fb0). */
    static final int SUNDAY = 0xFFE07A5F;
    static final int SATURDAY = 0xFF5A7FB0;
    static final int TODAY_FILL = 0xFFE2EEE6;
    static final int TODAY_INK = 0xFF2D5A43;
    /** Owner bars (design 2.4), the same as the app's month view: wife peach, husband sage, both sky blue. */
    static final int WIFE_BG = 0xFFFBDFD3;
    static final int WIFE_INK = 0xFF8F4128;
    static final int HUSBAND_BG = 0xFFD8EADF;
    static final int HUSBAND_INK = 0xFF2D5A43;
    static final int BOTH_BG = 0xFFD7E8F6;
    static final int BOTH_INK = 0xFF2C5A84;
    static final int WHITE = 0xFFFFFFFF;

    /**
     * Done todos (design 2.7) look like the app's 40% opacity over the white card, and bars wholly in the months
     * before and after are a little lighter: both are mixed this far towards white.
     */
    static final float DONE_FADE = 0.6f;
    static final float OTHER_MONTH_FADE = 0.45f;

    static final float WEEKDAY_H = 18f;
    static final float DATE_H = 16f;
    static final float ROW_BOTTOM = 2f;
    static final float BAR_GAP = 1.5f;
    static final float BAR_INSET = 1.5f;
    static final float BAR_RADIUS = 3f;
    static final float TODAY_RADIUS = 8.5f;
    /** Below this a bar gets too thin for a title; fewer lanes are drawn instead (never more than MAX_LANES). */
    static final float MIN_BAR_PITCH = 9f;

    /** How many bar lanes fit a row of this bitmap (MAX_LANES on a normal 4x4 widget). */
    public static int lanesFor(float heightPx, int weeks, float dp) {
        float rowH = (heightPx / dp - WEEKDAY_H) / Math.max(1, weeks);
        float area = rowH - DATE_H - ROW_BOTTOM;
        int fit = (int) Math.floor(area / MIN_BAR_PITCH);
        return Math.max(1, Math.min(CalendarLogic.MAX_LANES, fit));
    }

    /** Mixes c towards white by f (0 = c, 1 = white). */
    static int fade(int c, float f) {
        return mix(c, WHITE, f);
    }

    static int mix(int a, int b, float f) {
        int r = Math.round(((a >> 16) & 0xFF) * (1 - f) + ((b >> 16) & 0xFF) * f);
        int g = Math.round(((a >> 8) & 0xFF) * (1 - f) + ((b >> 8) & 0xFF) * f);
        int bl = Math.round((a & 0xFF) * (1 - f) + (b & 0xFF) * f);
        return 0xFF000000 | (r << 16) | (g << 8) | bl;
    }

    static int barBg(String owner) {
        if ("wife".equals(owner)) return WIFE_BG;
        if ("husband".equals(owner)) return HUSBAND_BG;
        return BOTH_BG;
    }

    static int barInk(String owner) {
        if ("wife".equals(owner)) return WIFE_INK;
        if ("husband".equals(owner)) return HUSBAND_INK;
        return BOTH_INK;
    }

    /** Pale red on Sunday, pale blue on Saturday (Monday-first column), else other. */
    static int weekdayInk(int col, int other) {
        int wd = CalendarLogic.weekdayOfCol(col);
        return wd == 0 ? SUNDAY : wd == 6 ? SATURDAY : other;
    }

    /**
     * Paints the whole calendar into a w x h pixel area (the caller clears it). weekdayNames[0] is Sunday (as
     * WidgetLogic.weekdayOf); the columns run Monday to Sunday. lanes is what layout was computed with (lanesFor).
     */
    public static void paint(Pen pen, float w, float h, float dp, CalendarLogic.Layout layout, int lanes, String today,
            String[] weekdayNames) {
        CalendarLogic.Month m = layout.month;
        float colW = w / 7f;
        float headH = WEEKDAY_H * dp;
        float rowH = (h - headH) / m.weeks;

        // Weekday row, Monday first: Sunday pale red, Saturday pale blue.
        float wdSize = 10f * dp;
        for (int c = 0; c < 7; c++) {
            String name = weekdayNames[CalendarLogic.weekdayOfCol(c)];
            int color = weekdayInk(c, INK_2);
            float tw = pen.textWidth(name, wdSize, false);
            pen.text(name, c * colW + (colW - tw) / 2f, headH * 0.66f, wdSize, color, false);
        }

        float numSize = 11f * dp;
        float numBase = 11.5f * dp;
        float barTop0 = DATE_H * dp;
        float area = rowH - barTop0 - ROW_BOTTOM * dp;
        float pitch = area / Math.max(1, lanes);
        float barH = Math.max(1f, pitch - BAR_GAP * dp);
        float titleSize = Math.min(10f * dp, barH * 0.78f);
        boolean titles = barH >= 7f * dp;
        float plusSize = 9f * dp;

        for (int week = 0; week < m.weeks; week++) {
            float top = headH + week * rowH;
            pen.fillRect(0, top, w, top + Math.max(1f, 0.75f * dp), LINE);
            for (int c = 0; c < 7; c++) {
                String day = m.dayAt(week, c);
                boolean inMonth = m.inMonth(day);
                String num = String.valueOf(WidgetLogic.parseYmd(day)[2]);
                float cx = c * colW + colW / 2f;
                boolean isToday = day.equals(today);
                float tw = pen.textWidth(num, numSize, isToday);
                float half = isToday ? Math.max(tw / 2f, TODAY_RADIUS * dp) : tw / 2f;

                // "+n" sits at the top right of the cell; on a narrow cell the date moves left to make room.
                int more = layout.hiddenAt(week, c);
                if (more > 0) {
                    String label = "+" + more;
                    float pw = pen.textWidth(label, plusSize, true);
                    float px = (c + 1) * colW - pw - 1.5f * dp;
                    float overlap = cx + half + 1.5f * dp - px;
                    if (overlap > 0) cx = Math.max(c * colW + half, cx - overlap);
                    pen.text(label, px, top + numBase, plusSize, inMonth ? INK_2 : INK_3, true);
                }

                int color = weekdayInk(c, INK);
                if (isToday) {
                    pen.fillCircle(cx, top + numBase - numSize * 0.36f, TODAY_RADIUS * dp, TODAY_FILL);
                    color = weekdayInk(c, TODAY_INK);
                }
                if (!inMonth) color = fade(color, 0.6f);
                pen.text(num, cx - tw / 2f, top + numBase, numSize, color, isToday);
            }
        }

        for (CalendarLogic.Bar b : layout.bars) {
            float top = headH + b.week * rowH + barTop0 + b.lane * pitch;
            float l = b.startCol * colW + (b.continuesBefore ? 0f : BAR_INSET * dp);
            float r = (b.endCol + 1) * colW - (b.continuesAfter ? 0f : BAR_INSET * dp);
            float bottom = top + barH;
            boolean otherMonth = !m.inMonth(m.dayAt(b.week, b.startCol)) && !m.inMonth(m.dayAt(b.week, b.endCol));
            int bg = barBg(b.event.owner);
            int ink = barInk(b.event.owner);
            if (b.event.done) {
                bg = fade(bg, DONE_FADE);
                ink = fade(ink, DONE_FADE);
            }
            if (otherMonth) {
                bg = fade(bg, OTHER_MONTH_FADE);
                ink = fade(ink, OTHER_MONTH_FADE);
            }
            float rad = Math.min(BAR_RADIUS * dp, barH / 2f);
            pen.fillRoundRect(l, top, r, bottom, rad, bg);
            // A bar that goes on in the previous or next row has a square end there.
            if (b.continuesBefore) pen.fillRect(l, top, l + rad, bottom, bg);
            if (b.continuesAfter) pen.fillRect(r - rad, top, r, bottom, bg);
            if (titles && b.event.title != null && !b.event.title.trim().isEmpty()) {
                float pad = 3f * dp;
                pen.save();
                pen.clip(l + pad, top, r - pad * 0.5f, bottom);
                pen.text(b.event.title.trim(), l + pad, top + barH / 2f + titleSize * 0.36f, titleSize, ink, false);
                pen.restore();
            }
        }
    }
}
