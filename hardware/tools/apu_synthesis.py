"""Run native generic Yosys resource screens for the physical APU slices.

This uses the standard proc/opt/memory flow and native write_json netlists.
No fabrication library, clock constraints, ABC mapping or STA is supplied.
https://yosyshq.readthedocs.io/projects/yosys/en/stable/using_yosys/synthesis/proc.html
"""

import argparse
import hashlib
import json
import shutil
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOPS = {
    "apu_badp_step": ("rtl/apu_badp_step.sv",),
    "apu_badp_decoder": ("rtl/apu_badp_step.sv", "rtl/apu_badp_decoder.sv"),
    "apu_upload_commit": ("rtl/apu_upload_commit.sv",),
}
FLOW = "proc; opt; memory -nomap; opt; check -assert; stat"


def describe_netlist(path, top):
    modules = json.loads(path.read_text())["modules"]
    cells = modules[top]["cells"]
    counts = Counter(c["type"] for c in cells.values())
    retained = Counter()
    multipliers = []
    memories = []
    for name, cell in cells.items():
        ports = cell["connections"]
        if cell["type"] == "$mem_v2":
            p = cell["parameters"]
            memories.append({
                "cell": name,
                "width": int(p["WIDTH"], 2),
                "rows": int(p["SIZE"], 2),
                "read_ports": int(p["RD_PORTS"], 2),
                "write_ports": int(p["WR_PORTS"], 2),
                "read_clocked": int(p["RD_CLK_ENABLE"], 2),
                "write_clocked": int(p["WR_CLK_ENABLE"], 2),
            })
        if cell["type"].startswith("$") and "Q" in ports:
            retained[cell["type"]] += len(ports["Q"])
        if cell["type"] == "$mul":
            constants = {
                p: sum((bit == "1") << i for i, bit in enumerate(bits))
                for p, bits in ports.items()
                if p in ("A", "B") and all(bit in ("0", "1") for bit in bits)
            }
            multipliers.append({"cell": name, "constant_operands": constants})
    return {
        "generic_cell_counts": dict(sorted(counts.items())),
        "retained_q_bits": sum(retained.values()),
        "retained_q_bits_by_cell": dict(sorted(retained.items())),
        "inferred_latch_cells": sum(
            v for k, v in counts.items() if "latch" in k.lower() or k == "$sr"
        ),
        "remaining_memory_cells": sum(v for k, v in counts.items() if k.startswith("$mem")),
        "inferred_memory_bits": sum(m["width"] * m["rows"] for m in memories),
        "inferred_memories": memories,
        "unresolved_external_module_cells": [
            name
            for name, c in cells.items()
            if not c["type"].startswith("$") and c["type"] not in modules
        ],
        "blackbox_modules": [
            name for name, m in modules.items() if int(m["attributes"].get("blackbox", "0"), 2)
        ],
        "multiply_cells": multipliers,
        "data_dependent_multiply_cells": sum(not m["constant_operands"] for m in multipliers),
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--yosys", required=True, help="Native Yosys executable path or command")
    args = cli.parse_args()
    version = subprocess.check_output([args.yosys, "-V"], text=True).strip()
    yosys = Path(shutil.which(args.yosys)).resolve()
    for directory in ("build/reports", "build/exports/rtl"):
        (ROOT / directory).mkdir(parents=True, exist_ok=True)
    report = {
        "scope": "Generic APU RTL resource screen; not ASIC area, power or timing qualification.",
        "tool": {
            "version": version,
            "binary": str(yosys),
            "binary_sha256": hashlib.sha256(yosys.read_bytes()).hexdigest(),
        },
        "producer_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "subprocess_timeout_seconds": 150,
        "flow": "read_verilog -sv <inputs>; hierarchy -check -top <top>; "
        + FLOW
        + "; write_json <netlist>",
        "modules": {},
        "limitations": [
            "Generic word-level/bit cells are unmapped to a fabrication library; counts are not ASIC gates or area.",
            "No cell timing, pad delays, clock/path constraints, STA, power or process corners are qualified.",
            "BADP ROM indices 89..255 remain unspecified and unqualified; synthesis can exploit undefined selectors.",
            "Inferred memories are generic cells, not selected or qualified ASIC SRAM macros; register Q-bit counts exclude their stored bits.",
            "Codec/state correctness is checked separately; synthesis does not prove those contracts.",
        ],
    }
    for top, inputs in TOPS.items():
        hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in inputs}
        log = Path(f"build/reports/{top}-synthesis.txt")
        net = Path(f"build/exports/rtl/{top}.json")
        command = (
            f"read_verilog -sv {' '.join(inputs)}; hierarchy -check -top {top}; "
            f"{FLOW}; write_json {net}"
        )
        if top == "apu_badp_step":
            command += (
                "; techmap; opt; check -assert; "
                "tee -o build/reports/apu_badp_step-techmap.txt stat; "
                "write_json build/exports/rtl/apu_badp_step-techmap.json"
            )
        subprocess.run(
            [str(yosys), "-Q", "-T", "-q", "-l", str(log), "-p", command],
            cwd=ROOT,
            check=True,
            timeout=150,
        )
        assert hashes == {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in inputs
        }, "RTL changed during synthesis"
        summary = describe_netlist(ROOT / net, top)
        summary.update(
            status="PASS",
            input_sha256=hashes,
            check_problems=0,
            raw_log=log.as_posix(),
            native_netlist=net.as_posix(),
            frontend_warnings=[
                line
                for line in (ROOT / log).read_text().splitlines()
                if line.startswith("Warning:")
            ],
        )
        if top == "apu_badp_step":
            mapped = describe_netlist(ROOT / "build/exports/rtl/apu_badp_step-techmap.json", top)
            summary["generic_techmap"] = {
                "cell_counts": mapped["generic_cell_counts"],
                "generic_bit_cells": sum(mapped["generic_cell_counts"].values()),
                "multipliers_remaining": len(mapped["multiply_cells"]),
                "raw_statistics": "build/reports/apu_badp_step-techmap.txt",
                "scope": "Generic techmap only, not ABC/library mapping or a fabrication gate budget.",
            }
        report["modules"][top] = summary
        print(json.dumps({"top": top, "retained_q_bits": summary["retained_q_bits"]}))
    report["combined_retained_q_bits_decoder_and_upload"] = sum(
        report["modules"][top]["retained_q_bits"]
        for top in ("apu_badp_decoder", "apu_upload_commit")
    )
    (ROOT / "build/reports/apu-synthesis.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
