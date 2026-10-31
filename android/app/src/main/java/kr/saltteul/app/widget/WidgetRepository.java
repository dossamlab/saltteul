package kr.saltteul.app.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.annotation.NonNull;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.FirebaseFirestoreException;
import com.google.firebase.firestore.Query;
import com.google.firebase.firestore.QuerySnapshot;
import com.google.firebase.firestore.Transaction;
import com.google.firebase.firestore.WriteBatch;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * Reads the household with one-shot Firestore get() calls, keeps a compact JSON copy in
 * SharedPreferences, and writes checkbox taps with the same fields as src/data/actions.ts.
 * Every Firebase call is guarded: without google-services.json FirebaseApp is not initialized,
 * and the widgets must show the sign-in message instead of crashing.
 */
public final class WidgetRepository {

    private static final String TAG = "SaltteulWidget";
    private static final String PREFS = "saltteul_widget";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_LAST_ATTEMPT = "lastAttempt";
    private static final String KEY_FAILURES = "failures";
    /** The household id is fixed for this two-person app. */
    static final String HOUSEHOLD = "households/home";

    private WidgetRepository() {}

    // ---------- cache ----------

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized Snapshot loadCache(Context c) {
        return Snapshot.fromJson(prefs(c).getString(KEY_SNAPSHOT, null));
    }

    public static synchronized void saveCache(Context c, Snapshot s) {
        prefs(c).edit().putString(KEY_SNAPSHOT, s.toJson()).apply();
    }

    static long lastAttempt(Context c) {
        return prefs(c).getLong(KEY_LAST_ATTEMPT, 0);
    }

    static void markAttempt(Context c, long now) {
        prefs(c).edit().putLong(KEY_LAST_ATTEMPT, now).apply();
    }

    static int failures(Context c) {
        return prefs(c).getInt(KEY_FAILURES, 0);
    }

    static void setFailures(Context c, int n) {
        prefs(c).edit().putInt(KEY_FAILURES, n).apply();
    }

    // ---------- Firebase access (never throws) ----------

    static FirebaseApp appOrNull(Context c) {
        try {
            if (FirebaseApp.getApps(c).isEmpty()) {
                // Returns null when google-services values are missing.
                return FirebaseApp.initializeApp(c.getApplicationContext());
            }
            return FirebaseApp.getInstance();
        } catch (Throwable e) {
            return null;
        }
    }

    /** Signed-in uid, or null when Firebase is missing or nobody is signed in. */
    public static String currentUid(Context c) {
        try {
            if (appOrNull(c) == null) return null;
            FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
            return u == null ? null : u.getUid();
        } catch (Throwable e) {
            return null;
        }
    }

    static FirebaseFirestore dbOrNull(Context c) {
        try {
            if (appOrNull(c) == null) return null;
            return FirebaseFirestore.getInstance();
        } catch (Throwable e) {
            return null;
        }
    }

    // ---------- read ----------

    /** Blocking; call from a worker thread. */
    public static Snapshot fetchBlocking(Context c, long timeoutSec) throws Exception {
        long now = System.currentTimeMillis();
        String uid = currentUid(c);
        FirebaseFirestore db = dbOrNull(c);
        if (uid == null || db == null) return Snapshot.signedOut(now);

        DocumentReference home = db.document(HOUSEHOLD);
        String day = WidgetLogic.householdDate(now);
        Task<QuerySnapshot> todosT = home.collection("todos").whereEqualTo("done", false).get();
        Task<QuerySnapshot> shopT = home.collection("shopping").whereEqualTo("bought", false).get();
        Task<QuerySnapshot> routinesT = home.collection("routines").get();
        Task<QuerySnapshot> logsT = home.collection("routineLogs").whereEqualTo("day", day).get();
        Task<QuerySnapshot> annT = home.collection("anniversaries").get();
        Task<QuerySnapshot> briefT = home.collection("briefings")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(1).get();
        Task<QuerySnapshot> membersT = home.collection("members").get();
        Task<DocumentSnapshot> settingsT = home.collection("settings").document("main").get();
        Task<QuerySnapshot> pantryT = home.collection("pantry").get();

        List<Task<?>> all = Arrays.<Task<?>>asList(todosT, shopT, routinesT, logsT, annT, briefT, membersT, settingsT,
                pantryT);
        Tasks.await(Tasks.whenAllComplete(all), timeoutSec, TimeUnit.SECONDS);
        for (Task<?> t : all) {
            Exception e = t.getException();
            if (e == null) continue;
            if (e instanceof FirebaseFirestoreException
                    && ((FirebaseFirestoreException) e).getCode() == FirebaseFirestoreException.Code.PERMISSION_DENIED) {
                // Signed in but not a member of the household (or rules reject): same message as signed out.
                return Snapshot.signedOut(now);
            }
            throw e;
        }

        Snapshot s = new Snapshot();
        s.status = Snapshot.STATUS_OK;
        s.fetchedAt = now;
        s.uid = uid;
        for (DocumentSnapshot d : todosT.getResult().getDocuments()) {
            String date = str(d.get("date"));
            if (!WidgetLogic.isYmd(date)) continue; // undated todos never show on widgets
            Snapshot.Todo t = new Snapshot.Todo(d.getId(), str(d.get("title")), date, str(d.get("time")),
                    str(d.get("owner")), str(d.get("source")));
            s.todos.add(t);
        }
        for (DocumentSnapshot d : shopT.getResult().getDocuments()) {
            Double created = num(d.get("createdAt"));
            Snapshot.Shop sh = new Snapshot.Shop(d.getId(), str(d.get("name")), str(d.get("consumableId")),
                    created == null ? 0 : created.longValue());
            sh.pantryId = str(d.get("pantryId"));
            s.shopping.add(sh);
        }
        for (DocumentSnapshot d : routinesT.getResult().getDocuments()) {
            Double order = num(d.get("order"));
            Boolean active = d.getBoolean("active");
            s.routines.add(new Snapshot.Routine(d.getId(), str(d.get("title")), str(d.get("owner")),
                    weekdays(d.get("weekdays")), order == null ? 0 : order, active == null || active));
        }
        for (DocumentSnapshot d : logsT.getResult().getDocuments()) {
            String routineId = str(d.get("routineId"));
            s.routineLogIds.add(routineId != null ? WidgetLogic.routineLogId(routineId, day) : d.getId());
        }
        for (DocumentSnapshot d : annT.getResult().getDocuments()) {
            s.anniversaries.add(new Snapshot.Anniversary(d.getId(), str(d.get("kind")), str(d.get("title")),
                    str(d.get("date"))));
        }
        List<DocumentSnapshot> briefs = briefT.getResult().getDocuments();
        if (!briefs.isEmpty()) s.headline = str(briefs.get(0).get("headline"));
        for (DocumentSnapshot d : membersT.getResult().getDocuments()) {
            String role = str(d.get("role"));
            String name = str(d.get("displayName"));
            if (role != null && name != null && !name.trim().isEmpty()) s.memberNames.put(role, name.trim());
        }
        DocumentSnapshot settings = settingsT.getResult();
        Object weather = settings.exists() ? settings.get("weather") : null;
        if (weather instanceof Map) {
            Object days = ((Map<?, ?>) weather).get("days");
            if (days instanceof List) {
                for (Object o : (List<?>) days) {
                    if (!(o instanceof Map)) continue;
                    Map<?, ?> w = (Map<?, ?>) o;
                    s.weather.add(new Snapshot.Weather(str(w.get("day")), num(w.get("minC")), num(w.get("maxC")),
                            num(w.get("popMax"))));
                }
            }
        }
        for (DocumentSnapshot d : pantryT.getResult().getDocuments()) {
            Double qty = num(d.get("qty"));
            Double minQty = num(d.get("minQty"));
            String expiry = str(d.get("expiry"));
            s.pantry.add(new Snapshot.Pantry(d.getId(), str(d.get("name")), str(d.get("unit")),
                    qty == null ? 0 : (int) Math.max(0, Math.round(qty)), minQty == null ? 0 : minQty,
                    WidgetLogic.isYmd(expiry) ? expiry : null));
        }
        return s;
    }

    private static String str(Object v) {
        return v instanceof String ? (String) v : null;
    }

    private static Double num(Object v) {
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    private static int[] weekdays(Object v) {
        if (!(v instanceof List)) return null;
        List<?> l = (List<?>) v;
        List<Integer> out = new ArrayList<>();
        for (Object o : l) if (o instanceof Number) out.add(((Number) o).intValue());
        int[] arr = new int[out.size()];
        for (int i = 0; i < arr.length; i++) arr[i] = out.get(i);
        return arr;
    }

    // ---------- write ----------

    /**
     * Writes one checkbox tap or pantry −1. Blocking; call from a worker thread.
     * If the network is slow the write stays queued in Firestore's local cache and syncs later.
     */
    public static void writeToggleBlocking(Context c, String target, String id, boolean wasChecked,
            String consumableId, String pantryId, String uid, String day, long now, long timeoutSec) throws Exception {
        FirebaseFirestore db = dbOrNull(c);
        if (db == null || uid == null || id == null) return;
        DocumentReference home = db.document(HOUSEHOLD);
        Task<?> task;
        if (WidgetLogic.TARGET_PANTRY.equals(target)) {
            task = usePantryItem(db, home, id, uid, now);
        } else if (WidgetLogic.TARGET_TODO.equals(target)) {
            boolean done = !wasChecked;
            Map<String, Object> patch = new HashMap<>();
            patch.put("done", done);
            patch.put("doneBy", done ? uid : null);
            patch.put("doneAt", done ? now : null);
            patch.put("updatedAt", now);
            patch.put("syncOrigin", "app");
            task = home.collection("todos").document(id).update(patch);
        } else if (WidgetLogic.TARGET_SHOPPING.equals(target)) {
            boolean bought = !wasChecked;
            WriteBatch b = db.batch();
            Map<String, Object> patch = new HashMap<>();
            patch.put("bought", bought);
            patch.put("boughtBy", bought ? uid : null);
            patch.put("boughtAt", bought ? now : null);
            b.update(home.collection("shopping").document(id), patch);
            if (consumableId != null && !consumableId.isEmpty()) {
                // Same as the web app: buying a linked consumable records today's purchase.
                DocumentReference cref = home.collection("consumables").document(consumableId);
                try {
                    DocumentSnapshot cs = Tasks.await(cref.get(), timeoutSec, TimeUnit.SECONDS);
                    if (cs.exists()) {
                        List<String> purchases = new ArrayList<>();
                        Object p = cs.get("purchases");
                        if (p instanceof List) for (Object o : (List<?>) p) if (o instanceof String) purchases.add((String) o);
                        b.update(cref, "purchases", WidgetLogic.purchasesAfterBuy(purchases, day, bought));
                    }
                } catch (ExecutionException e) {
                    Log.w(TAG, "consumable read failed; updating the shopping item only", e);
                }
            }
            if (pantryId != null && !pantryId.isEmpty()) {
                // Same as the web app: a linked pantry item gets its restockQty; unticking takes it back off.
                DocumentReference pref = home.collection("pantry").document(pantryId);
                try {
                    DocumentSnapshot ps = Tasks.await(pref.get(), timeoutSec, TimeUnit.SECONDS);
                    Double restock = ps.exists() ? num(ps.get("restockQty")) : null;
                    if (restock != null && restock > 0) {
                        Double q = num(ps.get("qty"));
                        long before = q == null ? 0 : Math.round(q);
                        long amount = WidgetLogic.pantryAmount(restock);
                        long after = WidgetLogic.pantryAfterShopping(before, amount, bought);
                        Map<String, Object> pp = new HashMap<>();
                        pp.put("qty", after);
                        pp.put("updatedAt", now);
                        pp.put("updatedBy", uid);
                        b.update(pref, pp);
                        Map<String, Object> log = new HashMap<>();
                        log.put("itemId", pantryId);
                        log.put("name", str(ps.get("name")));
                        log.put("op", bought ? "buy" : "use");
                        log.put("amount", amount);
                        log.put("before", before);
                        log.put("after", after);
                        log.put("by", uid);
                        log.put("at", now);
                        log.put("source", "shopping");
                        b.set(home.collection("pantryLog").document(), log);
                    }
                } catch (ExecutionException e) {
                    Log.w(TAG, "pantry read failed; updating the shopping item only", e);
                }
            }
            task = b.commit();
        } else if (WidgetLogic.TARGET_ROUTINE.equals(target)) {
            DocumentReference ref = home.collection("routineLogs").document(WidgetLogic.routineLogId(id, day));
            if (wasChecked) {
                task = ref.delete();
            } else {
                Map<String, Object> log = new HashMap<>();
                log.put("routineId", id);
                log.put("day", day);
                log.put("doneBy", uid);
                log.put("doneAt", now);
                task = ref.set(log);
            }
        } else {
            return;
        }
        Tasks.await(task, timeoutSec, TimeUnit.SECONDS);
    }

    /**
     * The widget's −1, as changePantryQty(op 'use', amount 1, source 'widget') in src/data/actions.ts.
     * A transaction reads the current count so two quick taps (or both phones) never use the same unit twice.
     * Unlike plain writes, transactions need the network; offline the refresh afterwards shows the old count.
     */
    private static Task<Void> usePantryItem(FirebaseFirestore db, DocumentReference home, String id, final String uid,
            final long now) {
        final DocumentReference ref = home.collection("pantry").document(id);
        final DocumentReference logRef = home.collection("pantryLog").document();
        return db.runTransaction(new Transaction.Function<Void>() {
            @Override
            public Void apply(@NonNull Transaction tx) throws FirebaseFirestoreException {
                DocumentSnapshot d = tx.get(ref);
                if (!d.exists()) return null;
                Double q = num(d.get("qty"));
                long before = q == null ? 0 : Math.max(0, Math.round(q));
                if (before <= 0) return null; // already zero: nothing to use, no log line
                long after = WidgetLogic.pantryAfterUse(before);
                Map<String, Object> patch = new HashMap<>();
                patch.put("qty", after);
                patch.put("updatedAt", now);
                patch.put("updatedBy", uid);
                tx.update(ref, patch);
                Map<String, Object> log = new HashMap<>();
                log.put("itemId", ref.getId());
                log.put("name", str(d.get("name")));
                log.put("op", "use");
                log.put("amount", 1);
                log.put("before", before);
                log.put("after", after);
                log.put("by", uid);
                log.put("at", now);
                log.put("source", "widget");
                tx.set(logRef, log);
                return null;
            }
        });
    }
}
