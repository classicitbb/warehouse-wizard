package com.warehouse.wizard;

import android.app.DownloadManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * Warehouse Wizard — hands the downloaded APK to the system installer.
 *
 * Destination: android-twa/app-src-overrides/java/com/warehouse/wizard/DownloadCompleteReceiver.java
 * Registered exported=true in manifest-fragments/application-entries.xml
 * because DownloadManager.ACTION_DOWNLOAD_COMPLETE is a system broadcast
 * sent by another UID — Android requires the receiver to be exported to
 * receive it at all.
 *
 * Only acts on the download this app itself started (matched via the id
 * DownloadTriggerReceiver stored in SharedPreferences); completions from
 * other apps' DownloadManager usage are ignored.
 */
public class DownloadCompleteReceiver extends BroadcastReceiver {

    private static final String TAG = "WW.DownloadComplete";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
            return;
        }

        long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
        if (completedId == -1) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(
                DownloadTriggerReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        long pendingId = prefs.getLong(DownloadTriggerReceiver.PREF_PENDING_DOWNLOAD_ID, -1);

        if (pendingId == -1 || completedId != pendingId) {
            // Not our update download — ignore.
            return;
        }

        if (!wasDownloadSuccessful(context, completedId)) {
            Log.w(TAG, "Update download " + completedId + " did not complete successfully");
            clearPendingDownload(prefs);
            return;
        }

        try {
            File apkFile = new File(
                    context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    DownloadTriggerReceiver.APK_FILENAME);

            if (!apkFile.exists()) {
                Log.e(TAG, "Downloaded APK not found at expected path: " + apkFile);
                clearPendingDownload(prefs);
                return;
            }

            Uri contentUri = FileProvider.getUriForFile(
                    context, context.getPackageName() + ".fileprovider", apkFile);

            Intent installIntent = buildInstallIntent(contentUri);

            // Fire the installer immediately — this is what actually lets the
            // user upgrade in place. Android still shows its own "install
            // this app?" confirmation screen; there is no way around that
            // for a normal (non device-owner) app, by design.
            context.startActivity(installIntent);
            Log.i(TAG, "Launched package installer for " + apkFile);

        } catch (Exception e) {
            Log.e(TAG, "Failed to launch installer, falling back to notification", e);
            postInstallNotificationFallback(context);
        } finally {
            clearPendingDownload(prefs);
        }
    }

    private static Intent buildInstallIntent(Uri contentUri) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    private static boolean wasDownloadSuccessful(Context context, long downloadId) {
        DownloadManager downloadManager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (downloadManager == null) {
            return false;
        }

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = downloadManager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                return false;
            }
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;
            return status == DownloadManager.STATUS_SUCCESSFUL;
        }
    }

    /**
     * If startActivity() fails (e.g. OEM restrictions, or the receiver ran
     * with no foreground context on some Android versions), fall back to a
     * tap-to-install notification instead of silently giving up.
     */
    private static void postInstallNotificationFallback(Context context) {
        try {
            File apkFile = new File(
                    context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    DownloadTriggerReceiver.APK_FILENAME);
            Uri contentUri = FileProvider.getUriForFile(
                    context, context.getPackageName() + ".fileprovider", apkFile);
            Intent installIntent = buildInstallIntent(contentUri);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context, NotificationHelper.NOTIFICATION_ID_INSTALL_READY,
                    installIntent, flags);

            NotificationHelper.showInstallReady(context, pendingIntent);
        } catch (Exception e) {
            Log.e(TAG, "Install fallback notification also failed", e);
        }
    }

    private static void clearPendingDownload(SharedPreferences prefs) {
        prefs.edit()
                .remove(DownloadTriggerReceiver.PREF_PENDING_DOWNLOAD_ID)
                .remove(DownloadTriggerReceiver.PREF_PENDING_VERSION_CODE)
                .apply();
    }
}
