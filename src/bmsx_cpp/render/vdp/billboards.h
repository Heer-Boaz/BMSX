#pragma once

namespace bmsx {

class GameView;
class VDP;

void commitVdpBillboardViewState(GameView& view, const VDP& vdp);

} // namespace bmsx
