package com.warehouse.wizard;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;

/**
 * Warehouse Wizard — starts the native APK download.
 *
 * Destination: android-twa/app-src-overrides/java/com/warehouse/wizard/DownloadTriggerReceiver.java
 * Registered as non-exported in manifest-fragments/application-entries.xml
 * — only reachable via the PendingIntent NotificationHelper attaches to
 * the update notification, never from another app.
 *
 * Hands the APK URL straight to the system DownloadManager. This never
 * opens a browser: the file lands in the app's external files dir and
 * DownloadCompleteReceiver picks up the completion broadcast to launch
 * the installer.
 */
public class DownloadTriggerReceiver extends BroadcastReceiver {

    private static final String TAG = "WW.DownloadTrigger";

    public static final String EXTRA_APK_URL = "apk_url";
    public static final String EXTRA_VERSION_CODE = "version_code";
    public static final String EXTRA_VERSION_NAME = "version_name";

    public static final String PREFS_NAME = "ww_update_prefs";
    public static final String PREF_PENDING_DOWNLOAD_ID = "pending_download_id";
    public static final String PREF_PENDING_VERSION_CODE = "pending_version_code";

    static final String APK_FILENAME = "warehouse-wizard-update.apk";

    @Override
    public void onReceive(Context context, Intent intent) {
        String apkUrl = intent.getStringExtra(EXTRA_APK_URL);
        int versionCode = intent.getIntExtra(EXTRA_VERSION_CODE, -1);
        String versionName = intent.getStringExtra(EXTRA_VERSION_NAME);

        if (apkUrl == null || apkUrl.isEmpty()) {
            Log.w(TAG, "No apk_url in trigger intent, aborting download");
            return;
        }

        try {
            DownloadManager downloadManager =
                    (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                Log.e(TAG, "DownloadManager unavailable");
                return;
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl))
                    .setMimeType("application/vnd.android.package-archive")
                    .setTitle(context.getString(R.string.update_downloading_title))
                    .setDescription(versionName == null ? "" : "v" + versionName)
                    .setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(false)
                    .setDestinationInExternalFilesDir(
                            context, Environment.DIRECTORY_DOWNLOADS, APK_FILENAME);

            long downloadId = downloadManager.enqueue(request);

            // Remember which download we started so DownloadCompleteReceiver
            // only reacts to *our* completed download, not some unrelated
            // DownloadManager job from another app.
            SharedPreferences prefs =
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putLong(PREF_PENDING_DOWNLOAD_ID, downloadId)
                    .putInt(PREF_PENDING_VERSION_CODE, versionCode)
                    .apply();

            NotificationHelper.showDownloading(context);
            Log.i(TAG, "Enqueued update download id=" + downloadId + " url=" + apkUrl);

        } catch (Exception e) {
            Log.e(TAG, "Failed to enqueue update download", e);
        }
    }
}
