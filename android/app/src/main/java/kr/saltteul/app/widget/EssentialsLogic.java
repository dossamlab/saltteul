package kr.saltteul.app.widget;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The weather + 챙길 것 widget's one line (design 2026-11-14 section 1.2), without Android types. The first that
 * applies wins: things to bring for tomorrow's todos, unpacked items of a trip from a week before it starts through
 * the return day, open shopping, else nothing.
 */
public final class EssentialsLogic {

    private EssentialsLogic() {}

    public static final String KIND_PREP = "prep";
    public static final String KIND_TRIP = "trip";
    public static final String KIND_SHOPPING = "shopping";
    public static final String KIND_NONE = "none";

    /** A trip line shows from this many days before the start (shared/packing.ts HOME_DAYS_BEFORE). */
    static final int TRIP_DAYS_BEFORE = 7;
    /** Shopping names on the line before "…" (design example: 「장보기 5개 · 우유, 햇반, 기저귀…」). */
    static final int SHOPPING_NAMES = 3;

    public static final class Essential {
        public final String kind;
        /** Prep: things to bring (no repeats). Shopping: the first SHOPPING_NAMES names. */
        public final List<String> names = new ArrayList<>();
        /** Shopping: open items in all; more = names left out. */
        public int count;
        public boolean more;
        /** Trip. */
        public Snapshot.Trip trip;
        /** Trip: D-day label ("D-3", "D-day") or null while the trip is under way (the line then says so). */
        public String when;

        Essential(String kind) {
            this.kind = kind;
        }

        /** What a tap opens in the app (design section 6). */
        public String target() {
            if (KIND_TRIP.equals(kind) && trip != null && trip.id != null) return OpenTargets.trip(trip.id);
            if (KIND_SHOPPING.equals(kind)) return OpenTargets.SHOPPING;
            return OpenTargets.TODOS;
        }
    }

    /** Last day of the trip, the day the family comes home (shared/packing.ts returnDay). */
    public static String returnDay(Snapshot.Trip t) {
        return WidgetLogic.addDays(t.start, Math.max(0, t.nights));
    }

    /** A week before the start through the return day (shared/packing.ts homeTrips). */
    public static boolean tripInWindow(String start, int nights, String today) {
        if (!WidgetLogic.isYmd(start)) return false;
        String back = WidgetLogic.addDays(start, Math.max(0, nights));
        return WidgetLogic.diffDays(today, start) <= TRIP_DAYS_BEFORE && WidgetLogic.diffDays(today, back) >= 0;
    }

    /** Trip items counted 0 (overnight things on a day trip) are hidden and not counted (shared/packing.ts isShown). */
    public static boolean isShown(double qty) {
        return qty > 0;
    }

    public static Essential choose(Snapshot s, String today) {
        if (s == null) return new Essential(KIND_NONE);

        // 1. Things to bring for todos that start tomorrow.
        String tomorrow = WidgetLogic.addDays(today, 1);
        List<Snapshot.Todo> tmr = new ArrayList<>();
        for (Snapshot.Todo t : s.todos) {
            if (!t.done && t.date != null && t.date.startsWith(tomorrow) && !t.prepItems.isEmpty()) tmr.add(t);
        }
        Collections.sort(tmr, new Comparator<Snapshot.Todo>() {
            @Override
            public int compare(Snapshot.Todo a, Snapshot.Todo b) {
                String ta = a.time == null ? "99:99" : a.time;
                String tb = b.time == null ? "99:99" : b.time;
                int c = ta.compareTo(tb);
                return c != 0 ? c : WidgetLogic.nz(a.title).compareTo(WidgetLogic.nz(b.title));
            }
        });
        Set<String> prep = new LinkedHashSet<>();
        for (Snapshot.Todo t : tmr) {
            for (String n : t.prepItems) if (n != null && !n.trim().isEmpty()) prep.add(n.trim());
        }
        if (!prep.isEmpty()) {
            Essential e = new Essential(KIND_PREP);
            e.names.addAll(prep);
            return e;
        }

        // 2. A trip in its window with items still to pack, soonest first.
        Snapshot.Trip best = null;
        for (Snapshot.Trip t : s.trips) {
            if (!tripInWindow(t.start, t.nights, today) || t.total <= 0 || t.packed >= t.total) continue;
            if (best == null || t.start.compareTo(best.start) < 0
                    || (t.start.equals(best.start) && t.createdAt < best.createdAt)) {
                best = t;
            }
        }
        if (best != null) {
            Essential e = new Essential(KIND_TRIP);
            e.trip = best;
            int toStart = WidgetLogic.diffDays(today, best.start);
            // Same as the app's tripWhen: D-n before and on the first day, "여행 중" after that.
            e.when = toStart >= 0 ? WidgetLogic.dDayLabel(toStart) : null;
            return e;
        }

        // 3. Open shopping.
        List<Snapshot.Shop> shop = WidgetLogic.openShopping(s);
        if (!shop.isEmpty()) {
            Essential e = new Essential(KIND_SHOPPING);
            e.count = shop.size();
            for (int i = 0; i < shop.size() && e.names.size() < SHOPPING_NAMES; i++) {
                String n = shop.get(i).name;
                if (n != null && !n.trim().isEmpty()) e.names.add(n.trim());
            }
            e.more = shop.size() > e.names.size();
            return e;
        }
        return new Essential(KIND_NONE);
    }

    /** "우유, 햇반, 기저귀…": names joined by commas, with an ellipsis when some were left out. */
    public static String namesText(List<String> names, boolean more) {
        StringBuilder b = new StringBuilder();
        for (String n : names) {
            if (b.length() > 0) b.append(", ");
            b.append(n);
        }
        if (more) b.append('…');
        return b.toString();
    }

    public static final String ICON_CLEAR = "clear";
    public static final String ICON_PARTLY = "partly";
    public static final String ICON_CLOUDY = "cloudy";
    public static final String ICON_RAIN = "rain";
    public static final String ICON_SNOW = "snow";

    /** Weather icon for WeatherDay.sky: showers and sleet show rain; unknown sky shows partly cloudy. */
    public static String skyIcon(String sky) {
        if ("clear".equals(sky)) return ICON_CLEAR;
        if ("cloudy".equals(sky)) return ICON_CLOUDY;
        if ("rain".equals(sky) || "shower".equals(sky) || "rainsnow".equals(sky)) return ICON_RAIN;
        if ("snow".equals(sky)) return ICON_SNOW;
        return ICON_PARTLY;
    }

    /** "20° / 12°" (high / low, design 1.2), symbols only. Null when neither is known. */
    public static String highLow(Snapshot.Weather w) {
        if (w == null || (w.minC == null && w.maxC == null)) return null;
        return degrees(w.maxC) + " / " + degrees(w.minC);
    }

    private static String degrees(Double c) {
        return c == null ? "-" : Math.round(c) + "°";
    }
}
