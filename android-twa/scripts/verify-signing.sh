#!/usr/bin/env bash
# verify-signing.sh — Diagnose the APK signing failure
#
#   "Failed to obtain key with alias 'warehousewizard' ... Wrong password?
#    ... BadPaddingException: Given final block not properly padded."
#
# That error is raised by apksigner AFTER the keystore itself was already
# unlocked, at the point it tries to decrypt the private key. In other words
# the STORE password is correct and only the KEY password is being rejected.
#
# For a PKCS12 keystore (keytool's default since Java 9) the key password is
# almost always forced equal to the store password at creation time — so the
# "separate key password" you think you set often does not exist. This script
# proves which key password actually works, so you know exactly what to put in
# the ANDROID_KEY_PASSWORD GitHub secret.
#
# Runs anywhere Java's keytool is on PATH (Git Bash on Windows is fine).
#
# Usage:
#   bash verify-signing.sh /path/to/android.keystore [alias]
#
set -euo pipefail

KS="${1:-}"
ALIAS="${2:-warehousewizard}"

if [[ -z "$KS" || ! -f "$KS" ]]; then
  echo "Usage: bash verify-signing.sh /path/to/android.keystore [alias]" >&2
  echo "  (could not find a keystore at: '${KS:-<none given>}')" >&2
  exit 2
fi

command -v keytool >/dev/null 2>&1 || {
  echo "ERROR: 'keytool' not found on PATH. Install a JDK (e.g. Temurin 17)." >&2
  exit 2
}

echo "Keystore : $KS"
echo "Alias    : $ALIAS"
echo

# --- 1. Verify the STORE password -------------------------------------------
read -r -s -p "Enter the STORE password (ANDROID_KEYSTORE_PASSWORD): " STORE
echo
if ! keytool -list -keystore "$KS" -storepass "$STORE" -alias "$ALIAS" >/dev/null 2>&1; then
  echo
  echo "❌ STORE password is WRONG (or alias '$ALIAS' is not in this keystore)."
  echo "   Fix ANDROID_KEYSTORE_PASSWORD first, then re-run."
  exit 1
fi
echo "✅ STORE password is correct and alias '$ALIAS' exists."
echo

# --- 2. Find the KEY password that actually decrypts the private key --------
# Mirrors what apksigner does: retrieve/decrypt the private key. We do it by
# exporting the single entry to a throwaway PKCS12 — this fails with the exact
# same padding error if the key password is wrong.
test_keypass() {
  local candidate="$1"
  local tmp
  tmp="$(mktemp -u).p12"
  if keytool -importkeystore \
        -srckeystore "$KS" -srcstoretype PKCS12 \
        -destkeystore "$tmp" -deststoretype PKCS12 \
        -srcalias "$ALIAS" \
        -srcstorepass "$STORE" -srckeypass "$candidate" \
        -deststorepass changeit -destkeypass changeit >/dev/null 2>&1; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

echo "Testing candidate KEY passwords..."
if test_keypass "$STORE"; then
  echo
  echo "✅ The KEY password EQUALS the store password."
  echo "   ▶ Set the GitHub secret  ANDROID_KEY_PASSWORD  to the SAME value as"
  echo "     ANDROID_KEYSTORE_PASSWORD, then re-run the workflow."
  echo "     (This is the usual PKCS12 case and the most likely fix.)"
  exit 0
fi

echo "   ...not equal to the store password. Trying a value you supply."
read -r -s -p "Enter the KEY password you THINK you set: " KEYPW
echo
if test_keypass "$KEYPW"; then
  echo
  echo "✅ That KEY password is correct."
  echo "   ▶ Make sure ANDROID_KEY_PASSWORD holds EXACTLY that value —"
  echo "     re-paste it with no trailing spaces or newline (a stray newline"
  echo "     from copy/paste produces this exact error)."
  exit 0
fi

echo
echo "❌ Neither the store password nor the value you entered unlocks the key."
echo "   The key password saved in your password manager does not match this"
echo "   keystore. Options:"
echo "     • Try any other passwords you may have used at creation time."
echo "     • If none work, the key is unrecoverable — you must generate a NEW"
echo "       keystore (see android-twa/README.md 2.1) and update the SHA-256"
echo "       fingerprint in public/.well-known/assetlinks.json. Note: a new"
echo "       key changes the app's signing identity for fresh installs."
exit 1
