#pragma once

namespace bmsx {

class GameView;
struct GxGpuDeviceOutput;

void commitGxGpuViewSnapshot(GameView& view, const GxGpuDeviceOutput& output);

} // namespace bmsx
