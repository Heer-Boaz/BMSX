"""Exercise actual Make dependencies with the real rear-datum producer.

The CAD recipes are marker producers: real BRep intersections are checked by
check_rear_main.py and the assembly owner. This test covers scheduling only.
"""

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="bmsx-rear-incremental-") as tmp:
        root = Path(tmp)
        for directory in ("cad", "build/reports", "build/exports", "models/rear", "models/mainboard", "models/scart", "tools", "design", "ecad/mainboard", "ecad/av", "ecad/scart"):
            (root / directory).mkdir(parents=True)
        shutil.copy2(ROOT / "cad/rear_mate_datums.py", root / "cad/rear_mate_datums.py")
        shutil.copy2(ROOT / "cad/targets.mk", root / "cad/targets.mk")
        shutil.copy2(ROOT / "models/rear/mating.json", root / "models/rear/mating.json")
        for name in (
            "cad/compact_main_scene.py", "cad/compact_rear_io.py", "cad/check_rear_main.py",
            "cad/rear_components.py", "cad/board_model.py", "cad/fixtures.py", "cad/fasteners.py",
            "cad/geometry.py", "tools/mainboard.py", "ecad/mainboard/BMSX.kicad_pcb",
            "design/enclosure_rear_io.json", "models/mainboard/manifest.json", "models/rear/manifest.json",
            "ecad/av/board.json", "ecad/scart/board.json", "models/scart/K-SCART-021.json",
            "build/exports/BMSX_AV_BREAKOUT_board_native.step", "build/exports/BMSX_SCART_TERM_board_native.step",
        ):
            (root / name).write_text("fixture\n")
        board_path = root / "build/reports/mainboard.json"
        board = {
            "placements": [
                {"ref": "J61", "position_mm": [10, 20], "rotation_degrees": 90},
                {"ref": "J500", "position_mm": [30, 40], "rotation_degrees": 180},
                {"ref": "J300", "position_mm": [50, 60], "rotation_degrees": 0},
            ]
        }
        board_path.write_text(json.dumps(board))
        (root / "fake_cad.py").write_text("""\
import sys
from pathlib import Path
name = Path(sys.argv[1]).name
outputs = {
    'compact_main_scene.py': ('scene', 'build/reports/compact-main-scene.json', 'build/exports/BMSX_COMPACT_components.step'),
    'compact_rear_io.py': ('geometry', 'build/reports/compact-rear-io.json', 'build/exports/BMSX_COMPACT_rear_io.step'),
    'check_rear_main.py': ('crosscheck', 'build/reports/compact-rear-main-clearance.json'),
}[name]
with open('events', 'a') as log: log.write(outputs[0] + '\\n')
for path in outputs[1:]: Path(path).write_text(outputs[0] + '\\n')
""")
        (root / "Makefile").write_text("""\
REPORTS=build/reports
EXPORTS=build/exports
MAINBOARD=ecad/mainboard/BMSX
FRONT=ecad/front/BMSX_FRONT
KEYBOARD=ecad/keyboard/BMSX_KEYBOARD
AV=ecad/av/BMSX_AV_BREAKOUT
SCART=ecad/scart/BMSX_SCART_TERM
PYTHON=python3
CAD=python3 fake_cad.py
include cad/targets.mk
""")
        target = "build/reports/compact-rear-main-clearance.json"
        subprocess.run(["make", target], cwd=root, check=True, stdout=subprocess.DEVNULL)
        events = root / "events"
        assert events.read_text().splitlines() == ["geometry", "scene", "crosscheck"]

        time.sleep(0.02)
        board["placements"][2]["position_mm"][0] += 1
        board_path.write_text(json.dumps(board))
        subprocess.run(["make", target], cwd=root, check=True, stdout=subprocess.DEVNULL)
        assert events.read_text().splitlines() == ["geometry", "scene", "crosscheck", "scene", "crosscheck"]

        time.sleep(0.02)
        board["placements"][0]["position_mm"][0] += 1
        board_path.write_text(json.dumps(board))
        subprocess.run(["make", target], cwd=root, check=True, stdout=subprocess.DEVNULL)
        assert events.read_text().splitlines()[-3:] == ["geometry", "scene", "crosscheck"]

        time.sleep(0.02)
        mates = root / "models/rear/mating.json"
        mates.write_text(mates.read_text() + "\n")
        subprocess.run(["make", target], cwd=root, check=True, stdout=subprocess.DEVNULL)
        assert events.read_text().splitlines()[-2:] == ["geometry", "crosscheck"]
    print("PASS incremental rear CAD: unrelated J300 skips geometry but rechecks; J61 and mate geometry rebuild")


if __name__ == "__main__":
    main()
