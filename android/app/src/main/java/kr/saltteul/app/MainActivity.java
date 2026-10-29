package kr.saltteul.app;

import com.getcapacitor.BridgeActivity;
import kr.saltteul.app.widget.RefreshJob;

public class MainActivity extends BridgeActivity {

    @Override
    public void onStop() {
        super.onStop();
        // Leaving the app: show what was just changed (or the new sign-in) on the home-screen widgets.
        RefreshJob.enqueue(this, true);
    }
}
