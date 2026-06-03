#pragma once

namespace bmsx {

class GameView;
struct VdpDeviceOutput;

void commitVdpViewSnapshot(GameView& view, const VdpDeviceOutput& output);

} // namespace bmsx
