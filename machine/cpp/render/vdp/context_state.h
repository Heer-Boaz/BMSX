#pragma once

namespace bmsx {

class GameView;
class VDP;

void restoreVdpContextState(VDP& vdp, GameView& view);

} // namespace bmsx
