"""Produce the current mainboard placement datums used by the rear assembly.

Only connector positions and rotations affect rear mate geometry. Preserve the
output timestamp if these data are unchanged, like Ninja's restat build rule:
https://ninja-build.org/manual.html#ref_restat
The separate rear-main and whole-assembly checks still consume the full board.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    board = json.loads((ROOT / "build/reports/mainboard.json").read_text())
    mates = json.loads((ROOT / "models/rear/mating.json").read_text())
    refs = {mate["ref"] for mate in mates}
    datums = {
        row["ref"]: {
            "position_mm": row["position_mm"],
            "rotation_degrees": row["rotation_degrees"],
        }
        for row in board["placements"] if row["ref"] in refs
    }
    output = ROOT / "build/reports/rear-mate-datums.json"
    data = json.dumps(datums, indent=2) + "\n"
    if not output.exists() or output.read_text() != data:
        output.write_text(data)
    print(json.dumps({"rear_mate_datums": list(datums)}))


if __name__ == "__main__":
    main()
