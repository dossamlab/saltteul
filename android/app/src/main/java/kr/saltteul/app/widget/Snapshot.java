package kr.saltteul.app.widget;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Compact copy of the household data the widgets need. Stored as JSON in SharedPreferences
 * so widgets can draw instantly from cache. Pure Java (no Android types) so it is unit-testable.
 */
public final class Snapshot {

    public static final String STATUS_OK = "ok";
    /** Firebase not configured, nobody signed in, or the user is not a household member. */
    public static final String STATUS_SIGNED_OUT = "signedOut";

    public String status = STATUS_OK;
    public long fetchedAt;
    public String uid;
    /** Open (not done) dated todos. */
    public final List<Todo> todos = new ArrayList<>();
    /** Open (not bought) shopping items. */
    public final List<Shop> shopping = new ArrayList<>();
    public final List<Routine> routines = new ArrayList<>();
    /** Routine log doc ids (`${routineId}_${day}`) that exist. */
    public final List<String> routineLogIds = new ArrayList<>();
    public final List<Anniversary> anniversaries = new ArrayList<>();
    public final List<Weather> weather = new ArrayList<>();
    public String headline;
    /** role ('husband'|'wife') to display name. */
    public final Map<String, String> memberNames = new HashMap<>();

    public static Snapshot signedOut(long now) {
        Snapshot s = new Snapshot();
        s.status = STATUS_SIGNED_OUT;
        s.fetchedAt = now;
        return s;
    }

    public static final class Todo {
        public String id, title, date, time, owner, source;
        public boolean done;

        public Todo() {}

        public Todo(String id, String title, String date, String time, String owner, String source) {
            this.id = id;
            this.title = title;
            this.date = date;
            this.time = time;
            this.owner = owner;
            this.source = source;
        }
    }

    public static final class Shop {
        public String id, name, consumableId;
        public long createdAt;
        public boolean bought;

        public Shop() {}

        public Shop(String id, String name, String consumableId, long createdAt) {
            this.id = id;
            this.name = name;
            this.consumableId = consumableId;
            this.createdAt = createdAt;
        }
    }

    public static final class Routine {
        public String id, title, owner;
        /** null or empty = every day. 0=Sun..6=Sat */
        public int[] weekdays;
        public double order;
        public boolean active = true;

        public Routine() {}

        public Routine(String id, String title, String owner, int[] weekdays, double order, boolean active) {
            this.id = id;
            this.title = title;
            this.owner = owner;
            this.weekdays = weekdays;
            this.order = order;
            this.active = active;
        }
    }

    public static final class Anniversary {
        public String id, kind, title, date;

        public Anniversary() {}

        public Anniversary(String id, String kind, String title, String date) {
            this.id = id;
            this.kind = kind;
            this.title = title;
            this.date = date;
        }
    }

    public static final class Weather {
        public String day;
        public Double minC, maxC, popMax;

        public Weather() {}

        public Weather(String day, Double minC, Double maxC, Double popMax) {
            this.day = day;
            this.minC = minC;
            this.maxC = maxC;
            this.popMax = popMax;
        }
    }

    // ---------- JSON ----------

    public String toJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("v", 1);
            o.put("status", status);
            o.put("fetchedAt", fetchedAt);
            put(o, "uid", uid);
            put(o, "headline", headline);
            JSONArray a = new JSONArray();
            for (Todo t : todos) {
                JSONObject j = new JSONObject();
                put(j, "id", t.id);
                put(j, "title", t.title);
                put(j, "date", t.date);
                put(j, "time", t.time);
                put(j, "owner", t.owner);
                put(j, "source", t.source);
                j.put("done", t.done);
                a.put(j);
            }
            o.put("todos", a);
            a = new JSONArray();
            for (Shop s : shopping) {
                JSONObject j = new JSONObject();
                put(j, "id", s.id);
                put(j, "name", s.name);
                put(j, "consumableId", s.consumableId);
                j.put("createdAt", s.createdAt);
                j.put("bought", s.bought);
                a.put(j);
            }
            o.put("shopping", a);
            a = new JSONArray();
            for (Routine r : routines) {
                JSONObject j = new JSONObject();
                put(j, "id", r.id);
                put(j, "title", r.title);
                put(j, "owner", r.owner);
                if (r.weekdays != null) {
                    JSONArray w = new JSONArray();
                    for (int d : r.weekdays) w.put(d);
                    j.put("weekdays", w);
                }
                j.put("order", r.order);
                j.put("active", r.active);
                a.put(j);
            }
            o.put("routines", a);
            a = new JSONArray();
            for (String id : routineLogIds) a.put(id);
            o.put("routineLogIds", a);
            a = new JSONArray();
            for (Anniversary an : anniversaries) {
                JSONObject j = new JSONObject();
                put(j, "id", an.id);
                put(j, "kind", an.kind);
                put(j, "title", an.title);
                put(j, "date", an.date);
                a.put(j);
            }
            o.put("anniversaries", a);
            a = new JSONArray();
            for (Weather w : weather) {
                JSONObject j = new JSONObject();
                put(j, "day", w.day);
                putNum(j, "minC", w.minC);
                putNum(j, "maxC", w.maxC);
                putNum(j, "popMax", w.popMax);
                a.put(j);
            }
            o.put("weather", a);
            JSONObject m = new JSONObject();
            for (Map.Entry<String, String> e : memberNames.entrySet()) m.put(e.getKey(), e.getValue());
            o.put("memberNames", m);
            return o.toString();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Returns null for missing or unreadable cache. */
    public static Snapshot fromJson(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(json);
            Snapshot s = new Snapshot();
            s.status = str(o, "status");
            if (s.status == null) s.status = STATUS_OK;
            s.fetchedAt = o.optLong("fetchedAt", 0);
            s.uid = str(o, "uid");
            s.headline = str(o, "headline");
            JSONArray a = o.optJSONArray("todos");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject j = a.getJSONObject(i);
                Todo t = new Todo(str(j, "id"), str(j, "title"), str(j, "date"), str(j, "time"), str(j, "owner"), str(j, "source"));
                t.done = j.optBoolean("done", false);
                s.todos.add(t);
            }
            a = o.optJSONArray("shopping");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject j = a.getJSONObject(i);
                Shop sh = new Shop(str(j, "id"), str(j, "name"), str(j, "consumableId"), j.optLong("createdAt", 0));
                sh.bought = j.optBoolean("bought", false);
                s.shopping.add(sh);
            }
            a = o.optJSONArray("routines");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject j = a.getJSONObject(i);
                int[] wd = null;
                JSONArray w = j.optJSONArray("weekdays");
                if (w != null) {
                    wd = new int[w.length()];
                    for (int k = 0; k < w.length(); k++) wd[k] = w.getInt(k);
                }
                s.routines.add(new Routine(str(j, "id"), str(j, "title"), str(j, "owner"), wd,
                        j.optDouble("order", 0), j.optBoolean("active", true)));
            }
            a = o.optJSONArray("routineLogIds");
            for (int i = 0; a != null && i < a.length(); i++) s.routineLogIds.add(a.getString(i));
            a = o.optJSONArray("anniversaries");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject j = a.getJSONObject(i);
                s.anniversaries.add(new Anniversary(str(j, "id"), str(j, "kind"), str(j, "title"), str(j, "date")));
            }
            a = o.optJSONArray("weather");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject j = a.getJSONObject(i);
                s.weather.add(new Weather(str(j, "day"), num(j, "minC"), num(j, "maxC"), num(j, "popMax")));
            }
            JSONObject m = o.optJSONObject("memberNames");
            if (m != null) {
                Iterator<String> keys = m.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = str(m, k);
                    if (v != null) s.memberNames.put(k, v);
                }
            }
            return s;
        } catch (JSONException | RuntimeException e) {
            return null;
        }
    }

    private static void put(JSONObject o, String k, String v) throws JSONException {
        if (v != null) o.put(k, v);
    }

    private static void putNum(JSONObject o, String k, Double v) throws JSONException {
        if (v != null && !v.isNaN() && !v.isInfinite()) o.put(k, v.doubleValue());
    }

    private static String str(JSONObject o, String k) {
        if (!o.has(k) || o.isNull(k)) return null;
        Object v = o.opt(k);
        return v instanceof String ? (String) v : String.valueOf(v);
    }

    private static Double num(JSONObject o, String k) {
        if (!o.has(k) || o.isNull(k)) return null;
        double d = o.optDouble(k, Double.NaN);
        return Double.isNaN(d) ? null : d;
    }
}
