# LauncherActivity patch

Bubblewrap generates `LauncherActivity.java` — this repo does not own that
file, so it can't be committed as a plain override (its contents change
between Bubblewrap versions). Instead, CI inserts the two snippets below
into the generated file automatically. If you're building manually, paste
them in yourself.

## 1. Kick off the update check

Add to the top of `onCreate(Bundle savedInstanceState)`, right after
`super.onCreate(savedInstanceState)`:

```java
super.onCreate(savedInstanceState);

// Warehouse Wizard: self-hosted update check (see UpdateManager.java)
UpdateManager.checkForUpdate(this);

// Warehouse Wizard: request notification permission so the update
// prompt can actually show on Android 13+ (API 33). No-op on older
// versions and a no-op if already granted.
if (android.os.Build.VERSION.SDK_INT >= 33) {
    if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        requestPermissions(
                new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4321);
    }
}
```

## 2. Where CI finds the anchor

The CI splice script (`.github/workflows/android-build-deploy.yml`) looks
for the generated `LauncherActivity.java`'s `super.onCreate(savedInstanceState);`
line and inserts the block immediately after it. This line is stable
across Bubblewrap versions because it's required Android Activity
boilerplate — if a future Bubblewrap major version changes the generated
Activity's structure enough that this anchor disappears, the CI step logs
a warning and the build still succeeds (just without the boot-time update
check wired in), rather than failing the whole pipeline.
