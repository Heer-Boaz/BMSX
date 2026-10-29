"""Check that the rear/main owner rejects a real coincident BRep.

The actual rear conductor BRep is used twice as a deliberately overlapping
rear and main component in an isolated temporary workspace. No project
geometry is edited and no complete assembly is rebuilt.
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    original = json.loads((ROOT / "build/reports/compact-rear-io.json").read_text())
    conductor = original["physical_parts"]["DC_RAW9"]
    with tempfile.TemporaryDirectory(prefix="bmsx-rear-overlap-") as tmp:
        root = Path(tmp)
        (root / "cad").mkdir()
        (root / "build/reports").mkdir(parents=True)
        for name in ("check_rear_main.py", "geometry.py"):
            shutil.copy2(ROOT / "cad" / name, root / "cad" / name)
        path = root / conductor["brep"]
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / conductor["brep"], path)
        rear = {"physical_parts": {"DC_RAW9": conductor}, "receiving_spaces": {}}
        board = {"physical_parts": {"MAIN__DELIBERATE_OVERLAP": conductor}}
        (root / "build/reports/compact-rear-io.json").write_text(json.dumps(rear))
        (root / "build/reports/compact-main-scene.json").write_text(json.dumps(board))
        result = subprocess.run([sys.executable, "cad/check_rear_main.py"], cwd=root, capture_output=True, text=True)
        assert result.returncode != 0, result.stdout
        report = json.loads((root / "build/reports/compact-rear-main-clearance.json").read_text())
        hits = report["focused_main_material_intersections"]
        assert len(hits) == 1 and hits[0]["rear"] == "DC_RAW9"
        assert hits[0]["main"] == "MAIN__DELIBERATE_OVERLAP" and hits[0]["intersection_mm3"] > 0
        print(f"PASS real BRep overlap rejected: {hits[0]['intersection_mm3']:.6f} mm³")


if __name__ == "__main__":
    main()
