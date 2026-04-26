#pragma once

namespace bmsx {

class GameView;
class Memory;
class VDP;
class RuntimeAssets;

void commitVdpViewSnapshot(GameView& view, const VDP& vdp, const RuntimeAssets& assets, const Memory& memory);

} // namespace bmsx
