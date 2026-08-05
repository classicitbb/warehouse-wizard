#!/usr/bin/env python3
"""
Warehouse Wizard — computes the next Android versionCode/versionName and
writes a build-directory copy of twa-manifest.json with those values baked
in. The output MUST be named exactly `twa-manifest.json` (not e.g.
twa-manifest.runtime.json) — `bubblewrap update`/`build` look for that
literal filename in their working directory, they don't accept an
arbitrary path for the manifest itself (only `--manifest <directory>`).

versionCode must strictly increase with every release Google/Android will
accept, so this derives it from the GitHub Actions run number (always
monotonic, never reused, even across reruns of old workflows) rather than
hand-maintaining a counter in source control.

Note: the twa-manifest.json field is `appVersion` (not `appVersionName`,
despite the similarly-named Android `versionName` concept it maps to) —
see the field reference in https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md.

Usage:
    python3 bump-version.py --base ./twa-manifest.json \\
                             --out ./build/twa-manifest.json \\
                             --run-number 42 \\
                             --signing-key-alias warehousewizard
Writes GITHUB_OUTPUT keys: version_code, version_name (if $GITHUB_OUTPUT set).
"""

import argparse
import json
import os
from pathlib import Path

# Offset so versionCode never collides with any versionCode that may have
# been set by hand in twa-manifest.json during early manual testing.
VERSION_CODE_BASE = 1000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--run-number", required=True, type=int)
    parser.add_argument("--signing-key-alias")
    args = parser.parse_args()

    manifest = json.loads(Path(args.base).read_text(encoding="utf-8"))

    version_code = VERSION_CODE_BASE + args.run_number
    version_name = f"1.0.{args.run_number}"

    manifest["appVersionCode"] = version_code
    manifest["appVersion"] = version_name
    if args.signing_key_alias:
        manifest.setdefault("signingKey", {})
        manifest["signingKey"]["alias"] = args.signing_key_alias

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"versionCode={version_code} versionName={version_name} -> {out_path}")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"version_code={version_code}\n")
            f.write(f"version_name={version_name}\n")


if __name__ == "__main__":
    main()
