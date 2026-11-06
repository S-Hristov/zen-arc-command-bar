"""Installer tests: synthetic registry/profile only. No actual profile discovery."""
import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install.py")
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.profile = Path(self.tmp.name)
        self.mods = self.profile / "chrome/sine-mods/mods.json"
        self.mods.parent.mkdir(parents=True)
        self.other = {"other": {"id": "other", "enabled": True, "scripts": {"x.uc.js": {}}}}
        self.mods.write_text(json.dumps(self.other))
    def tearDown(self): self.tmp.cleanup()
    def test_dry_run_no_write(self):
        before = self.mods.read_bytes()
        installer.install(self.profile)
        self.assertEqual(before, self.mods.read_bytes())
        self.assertFalse((self.mods.parent / installer.MOD_ID).exists())
    def test_apply_and_remove_preserve_other_mods(self):
        with mock.patch.object(installer, "lock_closed_profile", lambda _: contextlib.nullcontext()):
            installer.install(self.profile, True)
            data = json.loads(self.mods.read_text())
            self.assertEqual(data["other"], self.other["other"])
            self.assertTrue(data[installer.MOD_ID]["supportsUnload"])
            self.assertTrue(data[installer.MOD_ID]["no-updates"])
            self.assertNotIn("origin", data[installer.MOD_ID])
            with self.assertRaises(ValueError): installer.install(self.profile, True)
            installer.uninstall(self.profile, True)
            self.assertEqual(json.loads(self.mods.read_text()), self.other)
            self.assertEqual(len(list(self.mods.parent.glob("mods.json.arc-command-bar.*.bak"))), 2)
    def test_no_sine_refused(self):
        self.mods.unlink()
        with self.assertRaises(ValueError): installer.install(self.profile)
    def test_symlinks_refused(self):
        target = self.profile / "other.json"; target.write_text("{}")
        self.mods.unlink(); self.mods.symlink_to(target)
        with self.assertRaises(ValueError): installer.ensure_safe(self.profile)
    def test_concurrent_registry_change_refused(self):
        before = self.mods.read_bytes(); self.mods.write_text("{}")
        with self.assertRaises(ValueError): installer.write_registry(self.mods, self.other, before)
    def test_unowned_directory_never_removed(self):
        d = self.mods.parent / installer.MOD_ID; d.mkdir(); (d / "valuable.txt").write_text("keep")
        with self.assertRaises(ValueError): installer.uninstall(self.profile, True)
        self.assertTrue((d / "valuable.txt").exists())
    def test_running_zen_refused(self):
        fake = mock.Mock(stdout="/Applications/Zen.app/Contents/MacOS/zen\n")
        with mock.patch.object(installer.subprocess, "run", return_value=fake):
            with self.assertRaises(ValueError):
                with installer.lock_closed_profile(self.profile): pass

if __name__ == "__main__": unittest.main()
