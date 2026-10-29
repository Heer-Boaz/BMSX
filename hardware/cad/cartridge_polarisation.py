"""Own complementary shell, frame and door geometry for cartridge polarisation.

The original card/contact models remain source inputs. Only the shell receives
an inward returned channel; connector terminals and card electronics do not move.
"""

import json
from pathlib import Path

from geometry import box

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "design/cartridge_polarisation.json"
SPEC = json.loads(SPEC_PATH.read_text())


def shell_with_channel(shape, centre):
    """Mould a returned side channel, retaining wall stock behind its bottom."""
    shift = (*centre, 0)
    stock = box(SPEC["shell_return_stock_local_bounds_mm"]).translate(shift)
    channel = box(SPEC["shell_channel_local_bounds_mm"]).translate(shift)
    return (
        shape.fuse(stock, stock.mirror("YZ", shift))
        .cut(channel)
        .cut(channel.mirror("YZ", shift))
        .clean()
    )


def frame_key(centre):
    """Two same-front rail roots/ribs, leaving stops and lid journals clear."""
    shift = (*centre, 0)
    key = (
        box(SPEC["frame_root_local_bounds_mm"])
        .fuse(
            box(SPEC["frame_middle_root_local_bounds_mm"]),
            box(SPEC["frame_upper_root_local_bounds_mm"]),
            box(SPEC["frame_rib_local_bounds_mm"]),
        )
        .translate(shift)
        .clean()
    )
    return key.fuse(key.mirror("YZ", shift))


def leaf_relief(centre, z_range=None):
    """Remove the rib's radial working region before rotating the door."""
    shift = (*centre, 0)
    region = list(SPEC["leaf_relief_local_bounds_mm"])
    if z_range is not None:
        region[2], region[5] = z_range
    relief = box(region).translate(shift)
    return relief.fuse(relief.mirror("YZ", shift))
