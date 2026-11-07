#!/usr/bin/env python3
"""Local Sine registration. Dry-run default. Zen must be fully quit for --apply.
Never edits prefs.js, user.js, userChrome.css, cookies, sessions, or other mods.
"""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MOD_ID = "arc-command-bar"
FILES = ("theme.json", "preferences.json", "arc-command-bar.uc.js", "LICENSE")
MARKER = ".arc-command-bar-local-install.json"


def check_hashes():
    sums = ROOT / "SHA256SUMS"
    if not sums.exists():
        raise ValueError("SHA256SUMS missing. Run npm run package before installing from source.")
    expected = {}
    for line in sums.read_text().splitlines():
        digest, name = line.split("  ", 1); expected[name] = digest
    for name in FILES:
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected.get(name):
            raise ValueError(f"Integrity check failed: {name}")


def ensure_safe(profile):
    if not profile.is_absolute() or not profile.is_dir():
        raise ValueError("Use an existing absolute profile ROOT path from about:profiles.")
    # Refuse symlinked managed paths rather than risking a write elsewhere.
    for path in [profile / "chrome", profile / "chrome/sine-mods", profile / "chrome/sine-mods/mods.json", profile / "chrome/sine-mods" / MOD_ID]:
        if path.is_symlink():
            raise ValueError(f"Symlinked managed path refused: {path}")
    mods = profile / "chrome/sine-mods/mods.json"
    if not mods.is_file():
        raise ValueError("Sine mods.json not found. Install/start Sine normally first; do not create one by hand.")
    registry = json.loads(mods.read_text())
    if not isinstance(registry, dict):
        raise ValueError("Unexpected Sine mods.json schema.")
    return mods, registry


@contextlib.contextmanager
def lock_closed_profile(profile):
    # Require all Zen windows closed, not merely the destination profile.
    output = subprocess.run(["ps", "-axo", "comm="], capture_output=True, text=True, check=True).stdout
    if any(line.strip().endswith(("/MacOS/zen", "/zen-bin")) or line.strip() == "zen" for line in output.splitlines()):
        raise ValueError("Zen is still running. Quit Zen (Cmd+Q), then retry.")
    lock = profile / ".parentlock"
    if lock.is_symlink() or (profile / "parent.lock").is_symlink():
        raise ValueError("Profile has a symlink lock. Close Zen; resolve stale locks using normal browser support, not this installer.")
    # POSIX advisory lock matches Gecko's profile lock. Do not create a new lock file.
    handle = lock.open("r+") if lock.exists() else None
    try:
        if handle:
            try: fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error: raise ValueError("Profile is locked; fully quit the browser.") from error
        yield
    finally:
        if handle:
            fcntl.lockf(handle, fcntl.LOCK_UN); handle.close()


def write_registry(path, registry, expected_bytes):
    if path.read_bytes() != expected_bytes:
        raise ValueError("mods.json changed during installation; refusing to overwrite it.")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = path.with_name(f"mods.json.{MOD_ID}.{stamp}.bak")
    shutil.copy2(path, backup)
    fd, tmp = tempfile.mkstemp(prefix=".arc-mods-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(registry, stream, indent=2); stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.chmod(tmp, path.stat().st_mode & 0o777)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    return backup


def install(profile, apply=False):
    mods, registry = ensure_safe(profile); check_hashes()
    destination = mods.parent / MOD_ID
    if MOD_ID in registry or destination.exists():
        raise ValueError("Arc Command Bar already exists. Remove it via Sine before reinstalling; no files overwritten.")
    print(f"Install {len(FILES)} files + ownership marker into {destination}")
    print(f"Add only [{MOD_ID}] to {mods}; back up registry first. No browser prefs changed.")
    print("Sine's unverified-JavaScript permission must be enabled by YOU in its settings.")
    if not apply: return
    with lock_closed_profile(profile):
        original = mods.read_bytes()
        # Reread inside the lock. Preserve all other Sine records.
        registry = json.loads(original)
        if MOD_ID in registry: raise ValueError("Mod was concurrently registered; refused.")
        destination.mkdir()
        try:
            for name in FILES: shutil.copy2(ROOT / name, destination / name)
            (destination / MARKER).write_text(json.dumps({"id": MOD_ID, "version": json.loads((ROOT / "theme.json").read_text())["version"], "files": list(FILES)}))
            manifest = json.loads((ROOT / "theme.json").read_text())
            registry[MOD_ID] = {**manifest, "enabled": True, "no-updates": True}
            backup = write_registry(mods, registry, original)
        except BaseException:
            # Only our just-created directory is removed, never an existing one.
            shutil.rmtree(destination)
            raise
    print(f"Installed. Backup: {backup}\nStart Zen. Enable unverified JS in Sine if needed; then restart once.")


def upgrade(profile, apply=False):
    mods, _ = ensure_safe(profile); check_hashes()
    destination = mods.parent / MOD_ID
    manifest = json.loads((ROOT / "theme.json").read_text())

    def read_owned():
        current_mods, _ = ensure_safe(profile)
        raw = current_mods.read_bytes()
        registry = json.loads(raw)
        entry = registry.get(MOD_ID)
        if not isinstance(entry, dict) or entry.get("id") != MOD_ID or entry.get("no-updates") is not True or entry.get("origin"):
            raise ValueError("Not a standalone local installation. Update through Sine instead.")
        if not destination.is_dir() or {p.name for p in destination.iterdir()} != {*FILES, MARKER}:
            raise ValueError("Unexpected mod directory contents; refusing to replace.")
        if any(p.is_symlink() or not p.is_file() for p in destination.iterdir()):
            raise ValueError("Unexpected or symlinked mod file; refusing to replace.")
        marker = json.loads((destination / MARKER).read_text())
        theme = json.loads((destination / "theme.json").read_text())
        if marker.get("id") != MOD_ID or set(marker.get("files", [])) != set(FILES) or theme.get("id") != MOD_ID:
            raise ValueError("Mod ownership marker or manifest did not match.")
        if theme.get("version") != entry.get("version"):
            raise ValueError("Installed manifest and registry versions do not agree.")
        return raw, registry, theme

    _, registry, theme = read_owned()
    print(f"Upgrade {destination} from {theme['version']} to {manifest['version']}; preserve preferences and other mods.")
    if not apply:
        return
    with lock_closed_profile(profile):
        raw, registry, theme = read_owned()
        # Do not convert a local installation into a remote Sine registration.
        keys = ("version", "description", "updatedAt")
        metadata = {key: manifest[key] for key in keys if key in manifest}
        theme.update(metadata)
        registry[MOD_ID].update(metadata)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        previous = destination.with_name(f".{MOD_ID}.previous.{stamp}")
        with tempfile.TemporaryDirectory(prefix=".arc-upgrade-", dir=mods.parent) as temp:
            replacement = Path(temp) / "new"
            replacement.mkdir()
            for name in FILES:
                shutil.copy2(ROOT / name, replacement / name)
            (replacement / "theme.json").write_text(json.dumps(theme, indent=2) + "\n")
            (replacement / MARKER).write_text(json.dumps({"id": MOD_ID, "version": theme["version"], "files": list(FILES)}))
            os.rename(destination, previous)
            try:
                os.rename(replacement, destination)
                backup = write_registry(mods, registry, raw)
            except BaseException:
                if destination.exists():
                    os.rename(destination, replacement)
                os.rename(previous, destination)
                raise
    print(f"Upgraded. Mod backup: {previous}\nRegistry backup: {backup}\nStart Zen to load the update.")


def uninstall(profile, apply=False):
    mods, registry = ensure_safe(profile)
    destination = mods.parent / MOD_ID
    if MOD_ID not in registry or not (destination / MARKER).is_file():
        raise ValueError("Not a local installation owned by this installer. Use Sine's Remove button instead.")
    print(f"Remove only [{MOD_ID}] from {mods} and only {destination}. Keep all preference values.")
    if not apply: return
    with lock_closed_profile(profile):
        original = mods.read_bytes(); registry = json.loads(original)
        del registry[MOD_ID]
        backup = write_registry(mods, registry, original)
        shutil.rmtree(destination)
    print(f"Removed. Registry backup: {backup}. Other mods untouched.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "upgrade", "uninstall"])
    parser.add_argument("--profile", required=True, type=Path, help="Absolute profile ROOT; not Local Directory")
    parser.add_argument("--apply", action="store_true", help="Actually change this profile; otherwise dry run")
    parser.add_argument("--confirm-zen-closed", action="store_true")
    args = parser.parse_args()
    if args.apply and not args.confirm_zen_closed:
        parser.error("--apply requires --confirm-zen-closed. Quit Zen with Cmd+Q first.")
    try: {"install": install, "upgrade": upgrade, "uninstall": uninstall}[args.action](args.profile, args.apply)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, f"Refused: {error}\n")

if __name__ == "__main__": main()
