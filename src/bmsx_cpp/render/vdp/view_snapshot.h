#pragma once

namespace bmsx {

class GameView;
class VDP;

void commitVdpViewSnapshot(GameView& view, const VDP& vdp);

} // namespace bmsx
