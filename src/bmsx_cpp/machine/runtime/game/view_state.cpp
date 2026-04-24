#include "machine/runtime/game/view_state.h"

#include "render/gameview.h"

namespace bmsx {

void initializeGameViewStateFromHost(GameViewState& state, const GameView& view) {
	state.viewportSize.x = static_cast<int>(view.viewportSize.x);
	state.viewportSize.y = static_cast<int>(view.viewportSize.y);
	state.crtPostprocessingEnabled = view.crt_postprocessing_enabled;
	state.enableNoise = view.applyNoise;
	state.enableColorBleed = view.applyColorBleed;
	state.enableScanlines = view.applyScanlines;
	state.enableBlur = view.applyBlur;
	state.enableGlow = view.applyGlow;
	state.enableFringing = view.applyFringing;
	state.enableAperture = view.applyAperture;
}

void syncGameViewViewportSizeFromHost(GameViewState& state, const GameView& view) {
	state.viewportSize.x = static_cast<int>(view.viewportSize.x);
	state.viewportSize.y = static_cast<int>(view.viewportSize.y);
}

void applyGameViewStateToHost(const GameViewState& state, GameView& view) {
	view.crt_postprocessing_enabled = state.crtPostprocessingEnabled;
	view.applyNoise = state.enableNoise;
	view.applyColorBleed = state.enableColorBleed;
	view.applyScanlines = state.enableScanlines;
	view.applyBlur = state.enableBlur;
	view.applyGlow = state.enableGlow;
	view.applyFringing = state.enableFringing;
	view.applyAperture = state.enableAperture;
}

} // namespace bmsx
