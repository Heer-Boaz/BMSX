#pragma once

namespace bmsx {

class GameView;
class VDP;

void commitVdpViewSnapshot(GameView& view, VDP& vdp);

} // namespace bmsx
