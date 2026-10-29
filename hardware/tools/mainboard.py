"""Read the editable KiCad mainboard's native placement and population metadata."""

import argparse
import hashlib
import json
from pathlib import Path

import pcbnew

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", default="ecad/mainboard/BMSX.kicad_pcb")
    parser.add_argument("--output", default="build/reports/mainboard.json")
    args = parser.parse_args()
    source = ROOT / args.board
    board = pcbnew.LoadBoard(str(source))
    placements = []
    for fp in sorted(board.GetFootprints(), key=lambda fp: fp.GetReference()):
        attributes = fp.GetAttributes()
        pads = list(fp.Pads())
        npth = sum(pad.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH for pad in pads)
        placements.append(
            {
                "ref": fp.GetReference(),
                "position_mm": [pcbnew.ToMM(fp.GetPosition().x), pcbnew.ToMM(fp.GetPosition().y)],
                "rotation_degrees": fp.GetOrientationDegrees(),
                "layer": board.GetLayerName(fp.GetLayer()),
                "footprint_id": str(fp.GetFPID().GetLibItemName()),
                "dnp": bool(attributes & pcbnew.FP_DNP),
                "excluded_from_bom": bool(attributes & pcbnew.FP_EXCLUDE_FROM_BOM),
                "pad_count": len(pads),
                "npth_pad_count": npth,
                "copper_pad_count": len(pads) - npth,
            }
        )
    result = {
        "board_source": str(source.relative_to(ROOT)),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "thickness_mm": pcbnew.ToMM(board.GetDesignSettings().GetBoardThickness()),
        "copper_layers": board.GetCopperLayerCount(),
        "footprint_count": len(placements),
        "unconnected_count": board.GetConnectivity().GetUnconnectedCount(False),
        "net_count": board.GetNetCount(),
        "pad_count": sum(row["pad_count"] for row in placements),
        "placements": placements,
    }
    target = ROOT / args.output
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"footprints": len(placements), "copper_layers": result["copper_layers"]}))


if __name__ == "__main__":
    main()
