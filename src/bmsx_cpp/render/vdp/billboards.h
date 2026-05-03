#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

class GameView;

void commitVdpBillboardViewState(GameView& view, const VDP::VdpHostOutput& output);

} // namespace bmsx
