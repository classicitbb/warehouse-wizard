package com.warehouse.wizard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Warehouse Wizard — update notification + channel management.
 *
 * Destination: android-twa/app-src-overrides/java/com/warehouse/wizard/NotificationHelper.java
 *
 * Owns the "app_updates" notification channel and posts the "update
 * available" notification. Tapping the notification does not open a
 * browser or the Play Store — its PendingIntent broadcasts to
 * DownloadTriggerReceiver, which pulls the APK via DownloadManager.
 */
public final class NotificationHelper {

    private static final String TAG = "WW.NotificationHelper";

    public static final String CHANNEL_ID = "app_updates";
    public static final int NOTIFICATION_ID_UPDATE = 1001;
    public static final int NOTIFICATION_ID_INSTALL_READY = 1002;

    /** Brand teal, matches the web app's theme/icon accent color. */
    private static final int BRAND_COLOR = 0xFF1ED2B0;

    private NotificationHelper() {
        // static utility, not instantiable
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.update_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(context.getString(R.string.update_channel_description));
        manager.createNotificationChannel(channel);
    }

    /**
     * Posts the "update available" notification. Tapping it triggers the
     * DownloadManager pull, not a browser download.
     */
    public static void showUpdateAvailable(
            Context context, String versionName, String apkUrl, int versionCode) {
        ensureChannel(context);

        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            // POST_NOTIFICATIONS not granted (API 33+) or channel disabled by
            // the user — the update will simply be picked up on next launch.
            Log.i(TAG, "Notifications disabled, skipping update prompt for v" + versionName);
            return;
        }

        Intent triggerIntent = new Intent(context, DownloadTriggerReceiver.class);
        triggerIntent.setAction("com.warehouse.wizard.ACTION_DOWNLOAD_UPDATE");
        triggerIntent.putExtra(DownloadTriggerReceiver.EXTRA_APK_URL, apkUrl);
        triggerIntent.putExtra(DownloadTriggerReceiver.EXTRA_VERSION_CODE, versionCode);
        triggerIntent.putExtra(DownloadTriggerReceiver.EXTRA_VERSION_NAME, versionName);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, NOTIFICATION_ID_UPDATE, triggerIntent, flags);

        String text = versionName.isEmpty()
                ? context.getString(R.string.update_notification_text)
                : context.getString(R.string.update_notification_text) + " (v" + versionName + ")";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_update_notification)
                .setColor(BRAND_COLOR)
                .setContentTitle(context.getString(R.string.update_notification_title))
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_UPDATE, builder.build());
    }

    /** Swaps the update notification for a "downloading" progress notification. */
    public static void showDownloading(Context context) {
        ensureChannel(context);
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_update_notification)
                .setColor(BRAND_COLOR)
                .setContentTitle(context.getString(R.string.update_downloading_title))
                .setProgress(0, 0, true)
                .setOngoing(true)
                .setAutoCancel(false);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_UPDATE, builder.build());
    }

    /** Posted once the APK has finished downloading and the installer intent has fired. */
    public static void showInstallReady(Context context, PendingIntent installIntent) {
        ensureChannel(context);
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_update_notification)
                .setColor(BRAND_COLOR)
                .setContentTitle(context.getString(R.string.update_ready_title))
                .setContentText(context.getString(R.string.update_ready_text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(installIntent);

        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID_UPDATE);
        NotificationManagerCompat.from(context)
                .notify(NOTIFICATION_ID_INSTALL_READY, builder.build());
    }
}
