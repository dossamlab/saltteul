package kr.saltteul.app.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Handles a checkbox tap (or a pantry −1, target 'pantry') on any widget row: updates the cache right
 * away so the widget redraws, writes to Firestore in the background, then asks for a fresh snapshot.
 */
public class ToggleReceiver extends BroadcastReceiver {

    private static final String TAG = "SaltteulWidget";
    public static final String ACTION_TOGGLE = "kr.saltteul.app.widget.TOGGLE";
    public static final String EXTRA_TARGET = "target";
    public static final String EXTRA_ID = "id";
    public static final String EXTRA_CHECKED = "checked";
    public static final String EXTRA_CONSUMABLE = "consumableId";
    public static final String EXTRA_PANTRY = "pantryId";
    /** Broadcast receivers get about 10 s; leave room for the cache write and finish(). */
    private static final long WRITE_TIMEOUT_SEC = 8;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_TOGGLE.equals(intent.getAction())) return;
        final Context c = context.getApplicationContext();
        final String target = intent.getStringExtra(EXTRA_TARGET);
        final String id = intent.getStringExtra(EXTRA_ID);
        final boolean wasChecked = intent.getBooleanExtra(EXTRA_CHECKED, false);
        final String consumableId = intent.getStringExtra(EXTRA_CONSUMABLE);
        final String pantryId = intent.getStringExtra(EXTRA_PANTRY);
        if (target == null || id == null) return;

        final String uid = WidgetRepository.currentUid(c);
        if (uid == null) {
            WidgetRenderer.renderAll(c);
            return;
        }
        final long now = System.currentTimeMillis();
        final String day = WidgetLogic.householdDate(now);

        try {
            Snapshot s = WidgetRepository.loadCache(c);
            if (s != null) {
                WidgetLogic.applyToggle(s, target, id, wasChecked, day);
                WidgetRepository.saveCache(c, s);
            }
            WidgetRenderer.renderAll(c);
        } catch (Throwable e) {
            Log.w(TAG, "optimistic toggle failed", e);
        }

        final PendingResult pending = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    WidgetRepository.writeToggleBlocking(c, target, id, wasChecked, consumableId, pantryId, uid, day, now,
                            WRITE_TIMEOUT_SEC);
                } catch (Throwable e) {
                    // A timeout leaves the write queued in Firestore's local cache; the refresh below shows the truth.
                    Log.w(TAG, "toggle write did not finish", e);
                } finally {
                    RefreshJob.enqueue(c, true);
                    pending.finish();
                }
            }
        }, "saltteul-widget-toggle").start();
    }
}
