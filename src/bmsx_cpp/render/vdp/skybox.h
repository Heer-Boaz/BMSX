#pragma once

namespace bmsx {

class GameView;
class VDP;
class Memory;

void commitVdpSkyboxViewState(GameView& view, const VDP& vdp, Memory& memory);

} // namespace bmsx
