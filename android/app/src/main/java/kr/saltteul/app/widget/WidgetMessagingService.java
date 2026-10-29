package kr.saltteul.app.widget;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService;

/**
 * Replaces the Capacitor Firebase Messaging plugin's service in the manifest. super keeps the
 * plugin working (tokens and message events reach the web app); silent data messages
 * {type: 'widget-refresh'} sent by functions/src/notify/widgetPing.ts also refresh the widgets.
 */
public class WidgetMessagingService extends MessagingService {

    static final String TYPE_WIDGET_REFRESH = "widget-refresh";

    @Override
    public void onNewToken(@NonNull String token) {
        // The plugin forwards the new token to the web app, which stores it under devices/.
        super.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        try {
            if (TYPE_WIDGET_REFRESH.equals(remoteMessage.getData().get("type"))) {
                RefreshJob.enqueue(getApplicationContext(), true);
            }
        } catch (Throwable ignored) {
            // Never break the plugin's message handling because of the widget.
        }
    }
}
