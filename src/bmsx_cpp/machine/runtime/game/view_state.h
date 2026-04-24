#pragma once

namespace bmsx {

struct Viewport {
	int x = 0;
	int y = 0;
};

struct GameViewState {
	Viewport viewportSize{0, 0};
	bool crtPostprocessingEnabled = true;
	bool enableNoise = true;
	bool enableColorBleed = true;
	bool enableScanlines = true;
	bool enableBlur = true;
	bool enableGlow = true;
	bool enableFringing = true;
	bool enableAperture = false;
};

class GameView;

void initializeGameViewStateFromHost(GameViewState& state, const GameView& view);
void syncGameViewViewportSizeFromHost(GameViewState& state, const GameView& view);
void applyGameViewStateToHost(const GameViewState& state, GameView& view);

} // namespace bmsx
