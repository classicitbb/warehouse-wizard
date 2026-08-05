#!/usr/bin/env python3
"""
Warehouse Wizard — splices app-src-overrides/ into a freshly generated
Bubblewrap Android project.

Bubblewrap's `init` command generates a full Gradle project (manifest,
Java sources, resources, build files) from twa-manifest.json. This script
takes that generated project and layers our boot-launch + self-update
additions on top of it:

  1. Copies every file under app-src-overrides/java/ into the project's
     Java source tree.
  2. Copies app-src-overrides/res/* into the project's res/ tree.
  3. Splices manifest-fragments/permissions.xml into AndroidManifest.xml
     right after the opening <manifest ...> tag.
  4. Splices manifest-fragments/application-entries.xml into
     AndroidManifest.xml right before </application>.
  5. Merges the extra <string> entries from app-src-overrides/res/values/strings.xml
     into the generated strings.xml (rather than overwriting it, since
     Bubblewrap's own strings.xml has required entries).
  6. Patches LauncherActivity.java per LauncherActivity-patch.md, anchored
     on `super.onCreate(savedInstanceState);`.

Every step is defensive: if an expected anchor string isn't found (e.g. a
future Bubblewrap version changed its templates), this script prints a
warning and continues rather than failing the whole CI run silently mid-way
through a partially-patched project.

Usage:
    python3 splice-overrides.py --project <generated-project-dir> \\
                                 --overrides <app-src-overrides-dir> \\
                                 --package com.warehouse.wizard
"""

import argparse
import shutil
import sys
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree as ET

WARNINGS = []


def warn(msg: str) -> None:
    WARNINGS.append(msg)
    print(f"::warning::{msg}")


def die(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


def copy_tree_merge(src: Path, dst: Path) -> None:
    """Copy every file in src into dst, creating directories as needed,
    overwriting any existing files (Bubblewrap never generates these paths
    itself, so collisions aren't expected — but overwrite defensively)."""
    if not src.exists():
        return
    for path in src.rglob("*"):
        if path.is_dir():
            continue
        rel = path.relative_to(src)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        print(f"  copied {rel}")


def splice_manifest(manifest_path: Path, overrides: Path) -> None:
    if not manifest_path.exists():
        die(f"Generated AndroidManifest.xml not found at {manifest_path}")

    text = manifest_path.read_text(encoding="utf-8")
    permissions = (overrides / "manifest-fragments" / "permissions.xml").read_text(encoding="utf-8")
    app_entries = (overrides / "manifest-fragments" / "application-entries.xml").read_text(encoding="utf-8")

    # Strip the leading XML comment block from each fragment before
    # inserting (the comment is documentation for humans reading the
    # fragment file directly, not meant to be duplicated into the final
    # manifest on every CI run).
    def strip_leading_comment(fragment: str) -> str:
        end = fragment.find("-->")
        return fragment[end + 3:].strip() if fragment.strip().startswith("<!--") else fragment

    permissions = strip_leading_comment(permissions)
    app_entries = strip_leading_comment(app_entries)

    # 1. Insert permissions right after the opening <manifest ...> tag.
    manifest_open_end = text.find(">", text.find("<manifest"))
    if manifest_open_end == -1:
        die("Could not find opening <manifest> tag in generated AndroidManifest.xml")
    insert_at = manifest_open_end + 1
    text = text[:insert_at] + "\n\n" + permissions + "\n" + text[insert_at:]

    # 2. Insert application entries right before </application>.
    close_app = text.rfind("</application>")
    if close_app == -1:
        die("Could not find </application> in generated AndroidManifest.xml")
    text = text[:close_app] + "\n" + app_entries + "\n" + text[close_app:]

    manifest_path.write_text(text, encoding="utf-8")
    print(f"  patched {manifest_path}")


def merge_strings(strings_path: Path, overrides: Path) -> None:
    override_strings_path = overrides / "res" / "values" / "strings.xml"
    if not strings_path.exists() or not override_strings_path.exists():
        warn(f"Skipping strings.xml merge, missing {strings_path} or override file")
        return

    try:
        generated_tree = ET.parse(strings_path)
        override_tree = ET.parse(override_strings_path)
    except ET.ParseError as exc:
        die(f"Could not parse strings.xml during merge: {exc}")

    generated_root = generated_tree.getroot()
    override_root = override_tree.getroot()

    entries = [deepcopy(child) for child in list(override_root) if child.tag == "string"]
    if not entries:
        warn("No <string> entries found in override strings.xml")
        return

    for entry in entries:
        generated_root.append(entry)

    generated_tree.write(strings_path, encoding="utf-8", xml_declaration=True)
    print(f"  merged {len(entries)} string(s) into {strings_path}")


def patch_launcher_activity(project_dir: Path, package: str) -> None:
    package_path = package.replace(".", "/")
    launcher_path = project_dir / "app" / "src" / "main" / "java" / package_path / "LauncherActivity.java"
    if not launcher_path.exists():
        warn(f"LauncherActivity.java not found at {launcher_path}, skipping update-check patch")
        return

    text = launcher_path.read_text(encoding="utf-8")
    anchor = "super.onCreate(savedInstanceState);"
    idx = text.find(anchor)
    if idx == -1:
        warn("Could not find 'super.onCreate(savedInstanceState);' anchor in "
             "LauncherActivity.java — boot-time update check was NOT wired in. "
             "See android-twa/app-src-overrides/LauncherActivity-patch.md to add it by hand.")
        return

    insert_at = idx + len(anchor)
    snippet = (
        "\n\n        // Warehouse Wizard: self-hosted update check (see UpdateManager.java)\n"
        "        UpdateManager.checkForUpdate(this);\n\n"
        "        // Warehouse Wizard: request notification permission (Android 13+)\n"
        "        if (android.os.Build.VERSION.SDK_INT >= 33) {\n"
        "            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)\n"
        "                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {\n"
        "                requestPermissions(\n"
        "                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4321);\n"
        "            }\n"
        "        }"
    )
    text = text[:insert_at] + snippet + text[insert_at:]
    launcher_path.write_text(text, encoding="utf-8")
    print(f"  patched {launcher_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, help="Path to the Bubblewrap-generated project root")
    parser.add_argument("--overrides", required=True, help="Path to android-twa/app-src-overrides")
    parser.add_argument("--package", default="com.warehouse.wizard")
    args = parser.parse_args()

    project_dir = Path(args.project).resolve()
    overrides_dir = Path(args.overrides).resolve()

    if not project_dir.exists():
        die(f"Project dir does not exist: {project_dir}")
    if not overrides_dir.exists():
        die(f"Overrides dir does not exist: {overrides_dir}")

    java_dst = project_dir / "app" / "src" / "main" / "java"
    res_dst = project_dir / "app" / "src" / "main" / "res"
    manifest_dst = project_dir / "app" / "src" / "main" / "AndroidManifest.xml"

    print("Copying Java sources...")
    copy_tree_merge(overrides_dir / "java", java_dst)

    print("Copying drawable/xml resources...")
    copy_tree_merge(overrides_dir / "res" / "drawable", res_dst / "drawable")
    copy_tree_merge(overrides_dir / "res" / "xml", res_dst / "xml")

    print("Splicing AndroidManifest.xml...")
    splice_manifest(manifest_dst, overrides_dir)

    print("Merging strings.xml...")
    merge_strings(res_dst / "values" / "strings.xml", overrides_dir)

    print("Patching LauncherActivity.java...")
    patch_launcher_activity(project_dir, args.package)

    if WARNINGS:
        print(f"\nCompleted with {len(WARNINGS)} warning(s) — review before shipping to admins.")
    else:
        print("\nAll overrides applied cleanly.")


if __name__ == "__main__":
    main()
