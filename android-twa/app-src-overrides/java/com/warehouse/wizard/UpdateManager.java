package com.warehouse.wizard;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Warehouse Wizard — self-hosted background update checker.
 *
 * Destination: android-twa/app-src-overrides/java/com/warehouse/wizard/UpdateManager.java
 * Invoked from LauncherActivity#onCreate — see
 * android-twa/app-src-overrides/LauncherActivity-patch.md.
 *
 * Fetches update-manifest.json from the GitHub Pages host (see
 * R.string.update_base_url) with a cache-busting timestamp query param,
 * compares its versionCode against the installed app version reported by
 * PackageManager, and hands off to NotificationHelper when a newer build
 * is available. No Play Store, no external update framework — just a
 * static JSON file and DownloadManager.
 *
 * Expected update-manifest.json shape:
 * {
 *   "versionCode": 7,
 *   "versionName": "1.0.6",
 *   "apkUrl": "downloads/warehouse-wizard-latest.apk"
 * }
 * apkUrl may be relative (resolved against update_base_url) or an absolute
 * https:// URL.
 */
public final class UpdateManager {

    private static final String TAG = "WW.UpdateManager";
    private static final String MANIFEST_FILENAME = "update-manifest.json";
    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 8000;

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private UpdateManager() {
        // static utility, not instantiable
    }

    /** Kicks off an async update check. Safe to call on the main thread. */
    public static void checkForUpdate(Context appContext) {
        final Context context = appContext.getApplicationContext();
        EXECUTOR.execute(() -> runCheck(context));
    }

    private static void runCheck(Context context) {
        try {
            String baseUrl = normalizeBaseUrl(
                    context.getString(R.string.update_base_url));
            String manifestUrl = baseUrl + MANIFEST_FILENAME
                    + "?cb=" + System.currentTimeMillis();

            JSONObject manifest = fetchJson(manifestUrl);
            if (manifest == null) {
                return;
            }

            int remoteVersionCode = manifest.optInt("versionCode", -1);
            String versionName = manifest.optString("versionName", "");
            String apkUrlRaw = manifest.optString("apkUrl", "");

            if (remoteVersionCode <= 0 || apkUrlRaw.isEmpty()) {
                Log.w(TAG, "update-manifest.json missing versionCode/apkUrl, skipping");
                return;
            }

            int localVersionCode = getInstalledVersionCode(context);
            Log.i(TAG, "Local versionCode=" + localVersionCode
                    + " remote versionCode=" + remoteVersionCode);

            if (remoteVersionCode <= localVersionCode) {
                Log.i(TAG, "Already up to date");
                return;
            }

            String apkUrl = resolveUrl(baseUrl, apkUrlRaw);
            // Cache-bust the APK download too, so DownloadManager doesn't
            // silently reuse a stale cached copy from a CDN edge.
            apkUrl += (apkUrl.contains("?") ? "&" : "?") + "cb=" + System.currentTimeMillis();

            NotificationHelper.showUpdateAvailable(
                    context, versionName, apkUrl, remoteVersionCode);

        } catch (Exception e) {
            // Update checks must never crash the app or block startup.
            Log.e(TAG, "Update check failed", e);
        }
    }

    private static JSONObject fetchJson(String urlString) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Pragma", "no-cache");
            connection.connect();

            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "update-manifest.json fetch failed, HTTP " + status);
                return null;
            }

            try (InputStream in = connection.getInputStream()) {
                String body = readStream(in);
                return new JSONObject(body);
            }
        } catch (org.json.JSONException je) {
            Log.w(TAG, "update-manifest.json was not valid JSON", je);
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readStream(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    private static int getInstalledVersionCode(Context context) throws Exception {
        PackageInfo packageInfo = context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            long versionCode = packageInfo.getLongVersionCode();
            return versionCode > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) versionCode;
        }

        return packageInfo.versionCode;
    }

    private static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.isEmpty()) {
            throw new IllegalStateException("R.string.update_base_url is not configured");
        }
        return baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    }

    private static String resolveUrl(String baseUrl, String maybeRelative) {
        if (maybeRelative.startsWith("http://") || maybeRelative.startsWith("https://")) {
            return maybeRelative;
        }
        return baseUrl + maybeRelative;
    }
}
