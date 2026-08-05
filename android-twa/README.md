# Warehouse Wizard — Android TWA Wrapper

This folder is the source for the native Android wrapper around the
Warehouse Wizard web app (hosted on Vercel at `https://warehousewizard.app`).
It is a [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
Trusted Web Activity (TWA) project, extended with:

- **Boot auto-launch** — the app starts itself after the device reboots
  (for dedicated warehouse scanner/handheld devices).
- **Self-hosted background updates** — the app checks a JSON manifest on
  startup, downloads new APKs directly (no Play Store), and prompts the
  user to install in place.

The web app itself is untouched by any of this — `warehousewizard.app`
still works exactly the same in a normal desktop or mobile browser. The TWA
is purely an additional native entry point for Android.

---

## 1. How this folder is organized

```
android-twa/
├── twa-manifest.json          Bubblewrap project config (source of truth)
├── app-src-overrides/         Files that get spliced into the Bubblewrap-
│   ├── AndroidManifest.xml    generated Android project after `bubblewrap init`
│   │                          (reference copy — manifest-fragments/ below is
│   │                          what CI actually splices in)
│   ├── LauncherActivity-patch.md
│   ├── manifest-fragments/
│   │   ├── permissions.xml
│   │   └── application-entries.xml
│   ├── res/
│   │   ├── values/strings.xml
│   │   ├── drawable/ic_update_notification.xml
│   │   └── xml/file_paths.xml
│   └── java/com/warehouse/wizard/
│       ├── BootReceiver.java
│       ├── UpdateManager.java
│       ├── NotificationHelper.java
│       ├── DownloadTriggerReceiver.java
│       └── DownloadCompleteReceiver.java
├── scripts/
│   ├── splice-overrides.py    Applies app-src-overrides/ onto the generated project
│   ├── bump-version.py        Computes versionCode/versionName for this build
│   └── write-update-manifest.py
├── site/                      GitHub Pages source — download page + assets.
│   ├── index.html             CI copies this, adds the built APK + a fresh
│   ├── assets/                update-manifest.json, then publishes the copy.
│   ├── downloads/
│   └── update-manifest.json   (placeholder until the first CI run)
└── README.md                  This file
```

Bubblewrap generates a full Android/Gradle project from `twa-manifest.json`
(a `LauncherActivity.java`, manifest, resources, Gradle build files, etc).
This repo does **not** commit that generated project — it's build output.
Instead, CI regenerates it from `twa-manifest.json` on every build and then
overlays the files in `app-src-overrides/` on top before compiling. This
keeps the repo small and means the generated project is never stale.

---

## 2. One-time setup

### 2.1 Generate a signing keystore

Every release must be signed with the **same** key forever, so do this once
and guard the file carefully.

```bash
keytool -genkeypair -v \
  -keystore android.keystore \
  -alias warehousewizard \
  -keyalg RSA -keysize 2048 -validity 10000
```

You'll be prompted for a keystore password and a key password — use a
password manager, you'll need them again below.

### 2.2 Get the SHA-256 fingerprint and wire up Digital Asset Links

TWAs only hide the browser address bar if the app's signing certificate is
verified against the website via Digital Asset Links. Get the fingerprint:

```bash
keytool -list -v -keystore android.keystore -alias warehousewizard
```

Copy the `SHA256:` value (format `AA:BB:CC:...`, remove the colons or keep
them — Google accepts either) into
`public/.well-known/assetlinks.json` **in the main repo root** (not this
folder) — that file is part of the web app and deploys to
`https://warehousewizard.app/.well-known/assetlinks.json` via Vercel. It
already has the right shape, it just needs the real fingerprint:

```json
"sha256_cert_fingerprints": ["YOUR:REAL:FINGERPRINT:HERE"]
```

Commit and let Vercel redeploy before testing the installed APK — until
that file is live, Android will show the app in a browser-chrome fallback
instead of full-screen.

### 2.3 Add GitHub Actions secrets

In the repo (`classicitbb/threeplmgmt`) → **Settings → Secrets and
variables → Actions**, add:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i android.keystore \| pbcopy` (or `base64 -w0 android.keystore` on Linux) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password from 2.1 |
| `ANDROID_KEY_ALIAS` | `warehousewizard` |
| `ANDROID_KEY_PASSWORD` | key password from 2.1 |

These should be **repository secrets**, not environment secrets. The
Android signing happens in the `build` job, and that job does not target a
GitHub Actions environment. The only environment in the workflow is the
`github-pages` deploy job, which is unrelated to keystore signing.

Keep `android.keystore` itself **out of git**. Store it somewhere safe
outside the repo (password manager, secrets vault) — if it's lost, you can
never publish an update under the same package identity again.

### 2.4 Enable GitHub Pages

**Settings → Pages** → Source: **`GitHub Actions`** (not "Deploy from a
branch" — the repo's existing `/docs` folder is internal documentation,
unrelated to this). The workflow publishes `android-twa/site/` directly
via `actions/deploy-pages`, so nothing needs to be committed to a branch.

GitHub will publish at `https://classicitbb.github.io/threeplmgmt/` by
default. To use a custom domain instead (e.g. `get.warehousewizard.app`),
add a `CNAME` file to `android-twa/site/` with the domain name and point a
DNS CNAME record at `classicitbb.github.io`, then set it in **Settings →
Pages → Custom domain**.

That URL is where you send warehouse admins to install the app, and it's
also the base URL the installed app polls for updates — if you change it,
update `R.string.update_base_url` in
`app-src-overrides/res/values/strings.xml` to match.

---

## 3. What the CI pipeline does

`.github/workflows/android-build-deploy.yml` runs on every push to `main`
that touches `android-twa/**`, or manually via "Run workflow":

1. Checks out the repo, installs Temurin JDK 17 via GitHub Actions, sets up
   Node, and installs `@bubblewrap/cli`. CI seeds Bubblewrap's config with
   that runner-provided `JAVA_HOME`, so Bubblewrap does **not** try to fetch
   its own JDK tarball in CI. Bubblewrap still owns the Android SDK
   provisioning itself under `~/.bubblewrap/`. This split is deliberate:
   mixing GitHub's runner-managed Android SDK env vars with Bubblewrap's own
   SDK location causes Gradle to fail with the "Several environment variables
   ... contain different paths to the SDK" error, but using the runner JDK
   avoids a brittle Bubblewrap JDK download dependency.
2. Decodes the keystore secret into `android-twa/build/android.keystore`.
3. Computes a new `versionCode` from the GitHub Actions run number (always
   increases, never collides), and writes a copy of `twa-manifest.json`
   with that version baked in to `android-twa/build/twa-manifest.json`.
4. Runs `bubblewrap update --skipVersionUpgrade` inside `android-twa/build`
   to generate the Android project **directly from that twa-manifest.json**
   — no live web-manifest fetch, fully deterministic. (Note: this is
   deliberately `update`, not `init` — `init --manifest <url>` expects the
   URL of the *web app's* `manifest.json` and derives its own twa-manifest
   interactively, which can't guarantee our pinned `packageId`. `update`
   reads a twa-manifest.json directly, which is what we want for CI.)
5. Copies everything from `android-twa/app-src-overrides/` on top of the
   generated project (boot receiver, update manager, notification/download
   plumbing, manifest permissions).
6. Builds a **signed** release APK and AAB with `bubblewrap build`
   (keystore passwords passed via the `BUBBLEWRAP_KEYSTORE_PASSWORD` /
   `BUBBLEWRAP_KEY_PASSWORD` env vars Bubblewrap reads specifically for
   CI use — no interactive prompt).
7. Stages a copy of `android-twa/site/` (the download page + assets),
   drops in the freshly built APK and a generated `update-manifest.json`,
   and publishes that staged folder straight to GitHub Pages via
   `actions/deploy-pages` — no git commit involved, so the APK binary
   never enters repo history.

The result: merging a change under `android-twa/` produces a new signed
APK, a new AAB (for Play Store submission if you ever want it), and an
updated download page — no local Android tooling required.

---

## 4. How boot auto-launch works

`BootReceiver` listens for `android.intent.action.BOOT_COMPLETED`
(`RECEIVE_BOOT_COMPLETED` permission, granted at install time). On boot it
builds an explicit `Intent` for `LauncherActivity` with
`FLAG_ACTIVITY_NEW_TASK` (required to start an Activity from a
non-Activity context) and starts it. This is the standard pattern used by
dedicated kiosk/handheld scanner deployments — it is **not** a hidden
background service; the app visibly opens.

> Starting an Activity directly from a `BOOT_COMPLETED` receiver is one of
> the small set of exceptions Android's background-activity-start
> restrictions explicitly allow, so this keeps working on modern Android
> versions without extra entitlements.

## 5. How the self-update system works

1. `LauncherActivity` calls `UpdateManager.checkForUpdate(this)` in
   `onCreate` — see the exact snippet in
   `app-src-overrides/LauncherActivity-patch.md` (CI applies it
   automatically; for a manual build, paste it in yourself).
2. `UpdateManager` fetches
   `https://<pages-host>/update-manifest.json?cb=<timestamp>` — the
   timestamp query param defeats CDN/browser caching so the check always
   sees the latest manifest.
3. It parses `{ "versionCode": N, "versionName": "...", "apkUrl": "..." }`
   and compares `versionCode` to `BuildConfig.VERSION_CODE`.
4. If newer, `NotificationHelper` posts a notification on the
   `app_updates` channel. Tapping it fires a `PendingIntent` broadcast to
   `DownloadTriggerReceiver`, which enqueues the APK download through the
   native `DownloadManager` (MIME type
   `application/vnd.android.package-archive`) — never a browser.
5. `DownloadCompleteReceiver` listens for
   `DownloadManager.ACTION_DOWNLOAD_COMPLETE`, wraps the downloaded file in
   a `FileProvider` content URI, and launches the system package installer.

**Important:** Android still requires the user to explicitly approve
"install unknown apps" for this app (a one-time permission,
`REQUEST_INSTALL_PACKAGES`) and to confirm the install screen — there is no
way for a normal (non-device-owner/MDM-enrolled) app to install silently,
by design. This pipeline automates everything up to that consent screen.

---

## 6. Manual build (without CI)

```bash
npm install -g @bubblewrap/cli
cd android-twa
mkdir -p build && cp twa-manifest.json build/twa-manifest.json
cd build
yes | bubblewrap update --skipVersionUpgrade
cd ..
python3 scripts/splice-overrides.py --project ./build --overrides ./app-src-overrides
cd build
BUBBLEWRAP_KEYSTORE_PASSWORD=<your keystore password> \
BUBBLEWRAP_KEY_PASSWORD=<your key password> \
  bubblewrap build
```

Output: `app-release-signed.apk` and `app-release-bundle.aab` in the
generated project root.

---

## 7. Updating the app later

Bump `appVersion` / `appVersionCode` in `twa-manifest.json` if you want
those to move too (CI overrides both regardless, using the run number via
`scripts/bump-version.py`, so it's safe to leave them alone). Push to
`main` — CI does the rest.
