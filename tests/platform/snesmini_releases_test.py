import fcntl
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

from scripts.snesmini.releases import collect_releases, publish_release


class NativeReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bmsx-native-releases-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "core"
        (self.root / "releases").mkdir(parents=True)

    def publish(self, contents, build_type="Release"):
        stage = Path(tempfile.mkdtemp(dir=self.temp.name))
        (stage / "acceptance.txt").write_text(contents)
        (stage / "core.so").write_bytes(b"x" * 4096)
        release_id = hashlib.sha256(contents.encode()).hexdigest()
        with (self.root / ".publish.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            publish_release(self.root, stage, build_type)
            collect_releases(self.root, True)
        return release_id

    def test_debug_cannot_replace_release_and_neither_channel_keeps_history(self):
        first = self.publish("release one")
        debug = self.publish("debug one", "Debug")
        self.assertEqual((self.root / "current").resolve().name, first)
        self.assertEqual((self.root / "debug").resolve().name, debug)
        latest = self.publish("release two")
        self.assertFalse((self.root / "releases" / first).exists())
        self.publish("debug two", "Debug")
        self.assertFalse((self.root / "releases" / debug).exists())
        self.assertEqual((self.root / "current").resolve().name, latest)
        self.assertEqual(len(list((self.root / "releases").iterdir())), 2)

    def test_make_targets_select_release_by_default_and_debug_explicitly(self):
        output = subprocess.check_output(["make", "-n", "libretro-snesmini", "libretro-snesmini-debug",
            "libretro-host-snesmini", "libretro-host-snesmini-debug"], text=True)
        self.assertEqual(re.findall(r'SNESMINI_BUILD_TYPE="([^"]+)"', output),
            ["Release", "Debug", "Release", "Debug"])

    def test_concurrent_publishers_leave_one_complete_selected_release(self):
        stages = []
        for contents in ["first concurrent build", "second concurrent build"]:
            stage = Path(tempfile.mkdtemp(dir=self.temp.name))
            (stage / "acceptance.txt").write_text(contents)
            (stage / "core.so").write_bytes(contents.encode())
            stages.append(stage)
        processes = [subprocess.Popen([sys.executable, "scripts/snesmini/releases.py", "publish",
            str(self.root), str(stage), "Release"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for stage in stages]
        for process in processes:
            _, error = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, error)
        releases = list((self.root / "releases").iterdir())
        self.assertEqual(releases, [(self.root / "current").resolve()])
        self.assertEqual((releases[0] / "core.so").read_bytes(),
            (releases[0] / "acceptance.txt").read_bytes())

    def test_published_pin_and_dry_run_preserve_artifacts(self):
        pinned = self.publish("pinned")
        (self.root / "pins").mkdir()
        pin = self.root / "pins" / "installed"
        pin.symlink_to(Path("..") / "releases" / pinned)
        self.publish("replacement")
        self.assertTrue((self.root / "releases" / pinned).is_dir())
        pin.unlink()
        result = collect_releases(self.root, False)
        self.assertEqual(result["removed"], [pinned])
        self.assertTrue((self.root / "releases" / pinned).is_dir())
        collect_releases(self.root, True)
        self.assertFalse((self.root / "releases" / pinned).exists())

    def test_loaded_core_survives_until_the_process_releases_its_mapping(self):
        active = self.publish("loaded core")
        path = self.root / "releases" / active / "core.so"
        process = subprocess.Popen([sys.executable, "-c",
            "import mmap,sys; f=open(sys.argv[1],'rb'); m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ); "
            "f.close(); print('ready',flush=True); sys.stdin.readline()", str(path)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline(), "ready\n")
            self.publish("new core")
            self.assertTrue(path.is_file())
        finally:
            process.communicate("close\n", timeout=5)
        collect_releases(self.root, True)
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
