package kr.saltteul.app.widget;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Loads a fresh snapshot from Firestore, caches it, and redraws every widget.
 * Uses the platform JobScheduler (API 21+) rather than WorkManager: no extra dependency, a network
 * constraint, and scheduling the same job id replaces a pending request (one refresh at a time).
 */
public class RefreshJob extends JobService {

    private static final String TAG = "SaltteulWidget";
    static final int JOB_ID = 47201;
    private static final long FETCH_TIMEOUT_SEC = 25;
    private static final int MAX_RETRIES = 2;
    /** onUpdate (every 30 min, and on launcher reloads) only refreshes when the last try is older than this. */
    private static final long STALE_MS = 10 * 60 * 1000L;

    private volatile Thread worker;

    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context c = getApplicationContext();
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                boolean retry = false;
                WidgetRepository.markAttempt(c, System.currentTimeMillis());
                try {
                    Snapshot s = WidgetRepository.fetchBlocking(c, FETCH_TIMEOUT_SEC);
                    WidgetRepository.saveCache(c, s);
                    WidgetRepository.setFailures(c, 0);
                } catch (Throwable e) {
                    Log.w(TAG, "widget refresh failed", e);
                    int failures = WidgetRepository.failures(c) + 1;
                    WidgetRepository.setFailures(c, failures);
                    retry = failures <= MAX_RETRIES;
                }
                WidgetRenderer.renderAll(c);
                jobFinished(params, retry);
            }
        }, "saltteul-widget-refresh");
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // Replaced by a newer request or lost the network: the next schedule covers it.
        Thread t = worker;
        if (t != null) t.interrupt();
        return false;
    }

    /** force = run even if one is already pending (FCM ping, checkbox tap, 04:01 reset, leaving the app). */
    public static void enqueue(Context c, boolean force) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            if (!force && js.getPendingJob(JOB_ID) != null) return;
            if (force) WidgetRepository.setFailures(c, 0);
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, RefreshJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .build();
            js.schedule(job);
        } catch (Throwable e) {
            Log.w(TAG, "could not schedule widget refresh", e);
        }
    }

    /** Periodic onUpdate path: refresh only when the cache is stale. */
    public static void requestIfStale(Context c) {
        long now = System.currentTimeMillis();
        long last = WidgetRepository.lastAttempt(c);
        if (now - last > STALE_MS || last > now) enqueue(c, false);
    }
}
