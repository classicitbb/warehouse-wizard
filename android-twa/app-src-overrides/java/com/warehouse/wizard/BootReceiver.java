package com.warehouse.wizard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Warehouse Wizard — boot auto-launch.
 *
 * Destination: android-twa/app-src-overrides/java/com/warehouse/wizard/BootReceiver.java
 * Registered via manifest-fragments/application-entries.xml.
 *
 * Dedicated warehouse scanner/handheld devices are typically racked,
 * shared, and rebooted unattended (power cycle, MDM policy, crash
 * recovery). This receiver brings the app straight back to the foreground
 * after boot instead of leaving the device sitting on the home screen.
 *
 * Starting an Activity directly from a BOOT_COMPLETED receiver is one of
 * the documented exceptions to Android's background-activity-start
 * restrictions, so FLAG_ACTIVITY_NEW_TASK is sufficient here without any
 * extra entitlement or foreground-service dance.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "WW.BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }

        Log.i(TAG, "Boot completed — launching Warehouse Wizard");

        try {
            Intent launchIntent = new Intent(context, LauncherActivity.class);
            launchIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launchIntent.putExtra("launched_from_boot", true);
            context.startActivity(launchIntent);
        } catch (Exception e) {
            // Never let a boot receiver crash the boot sequence.
            Log.e(TAG, "Failed to auto-launch after boot", e);
        }
    }
}
