#!/usr/bin/env python3
"""
Warehouse Wizard — writes docs/update-manifest.json, the file
UpdateManager.java polls on app startup.

Usage:
    python3 write-update-manifest.py --out ../../docs/update-manifest.json \\
                                      --version-code 1042 \\
                                      --version-name 1.0.42 \\
                                      --apk-path downloads/warehouse-wizard-latest.apk
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--version-code", required=True, type=int)
    parser.add_argument("--version-name", required=True)
    parser.add_argument("--apk-path", required=True,
                         help="Path relative to the update-manifest.json's own location")
    args = parser.parse_args()

    payload = {
        "versionCode": args.version_code,
        "versionName": args.version_name,
        "apkUrl": args.apk_path,
        "publishedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}: {payload}")


if __name__ == "__main__":
    main()
