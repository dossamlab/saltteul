package kr.saltteul.app.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import java.util.Collections;

/** Renders CalendarPainter into a Bitmap for the month calendar widget's ImageView. */
final class CalendarBitmap {

    private CalendarBitmap() {}

    /**
     * Upper bound on pixels (about 4.8 MB as ARGB_8888). A 4x4 phone widget at 3x is well under it; a large tablet
     * widget is drawn at a lower density and scaled up by the ImageView instead of using more memory.
     */
    static final int MAX_PIXELS = 1_200_000;

    static Bitmap draw(int widthDp, int heightDp, float density, CalendarLogic.Month month, Snapshot s, String today,
            String[] weekdayNames) {
        float dp = density;
        long px = (long) Math.round(widthDp * dp) * Math.round(heightDp * dp);
        if (px > MAX_PIXELS) dp = (float) (dp * Math.sqrt((double) MAX_PIXELS / px));
        int w = Math.max(1, Math.round(widthDp * dp));
        int h = Math.max(1, Math.round(heightDp * dp));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        int lanes = CalendarPainter.lanesFor(h, month.weeks, dp);
        CalendarLogic.Layout layout = CalendarLogic.layout(month, s == null ? Collections.<Snapshot.Todo>emptyList() : s.todos, lanes);
        CalendarPainter.paint(new CanvasPen(canvas), w, h, dp, layout, lanes, today, weekdayNames);
        return bmp;
    }

    static final class CanvasPen implements CalendarPainter.Pen {
        private final Canvas c;
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        private final Typeface regular = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL);
        private final Typeface bold = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD);
        private final RectF rect = new RectF();

        CanvasPen(Canvas c) {
            this.c = c;
            fill.setStyle(Paint.Style.FILL);
        }

        @Override
        public void fillRect(float l, float t, float r, float b, int argb) {
            fill.setColor(argb);
            c.drawRect(l, t, r, b, fill);
        }

        @Override
        public void fillRoundRect(float l, float t, float r, float b, float radius, int argb) {
            fill.setColor(argb);
            rect.set(l, t, r, b);
            c.drawRoundRect(rect, radius, radius, fill);
        }

        @Override
        public void fillCircle(float cx, float cy, float radius, int argb) {
            fill.setColor(argb);
            c.drawCircle(cx, cy, radius, fill);
        }

        private Paint text(float size, boolean b) {
            text.setTextSize(size);
            text.setTypeface(b ? bold : regular);
            return text;
        }

        @Override
        public float textWidth(String s, float size, boolean b) {
            return text(size, b).measureText(s);
        }

        @Override
        public void text(String s, float x, float baseline, float size, int argb, boolean b) {
            Paint p = text(size, b);
            p.setColor(argb);
            c.drawText(s, x, baseline, p);
        }

        @Override
        public void save() {
            c.save();
        }

        @Override
        public void clip(float l, float t, float r, float b) {
            c.clipRect(l, t, r, b);
        }

        @Override
        public void restore() {
            c.restore();
        }
    }
}
