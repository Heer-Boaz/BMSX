#pragma once

namespace bmsx {

class GameView;
class VDP;
class Memory;

void commitVdpViewSnapshot(GameView& view, const VDP& vdp, Memory& memory);

} // namespace bmsx
