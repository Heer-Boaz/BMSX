import type { GameView } from '../../../render/gameview';
import type { GameViewState } from '../contracts';

export function createGameViewState(view: GameView): GameViewState {
	return {
		viewportSize: {
			x: view.viewportSize.x,
			y: view.viewportSize.y,
		},
		crt_postprocessing_enabled: view.crt_postprocessing_enabled,
		enable_noise: view.enable_noise,
		enable_colorbleed: view.enable_colorbleed,
		enable_scanlines: view.enable_scanlines,
		enable_blur: view.enable_blur,
		enable_glow: view.enable_glow,
		enable_fringing: view.enable_fringing,
		enable_aperture: view.enable_aperture,
	};
}

export function cloneGameViewState(state: GameViewState): GameViewState {
	return {
		viewportSize: {
			x: state.viewportSize.x,
			y: state.viewportSize.y,
		},
		crt_postprocessing_enabled: state.crt_postprocessing_enabled,
		enable_noise: state.enable_noise,
		enable_colorbleed: state.enable_colorbleed,
		enable_scanlines: state.enable_scanlines,
		enable_blur: state.enable_blur,
		enable_glow: state.enable_glow,
		enable_fringing: state.enable_fringing,
		enable_aperture: state.enable_aperture,
	};
}

export function copyGameViewState(target: GameViewState, source: GameViewState): void {
	target.viewportSize.x = source.viewportSize.x;
	target.viewportSize.y = source.viewportSize.y;
	target.crt_postprocessing_enabled = source.crt_postprocessing_enabled;
	target.enable_noise = source.enable_noise;
	target.enable_colorbleed = source.enable_colorbleed;
	target.enable_scanlines = source.enable_scanlines;
	target.enable_blur = source.enable_blur;
	target.enable_glow = source.enable_glow;
	target.enable_fringing = source.enable_fringing;
	target.enable_aperture = source.enable_aperture;
}

export function initializeGameViewStateFromHost(state: GameViewState, view: GameView): void {
	state.viewportSize.x = view.viewportSize.x;
	state.viewportSize.y = view.viewportSize.y;
	state.crt_postprocessing_enabled = view.crt_postprocessing_enabled;
	state.enable_noise = view.enable_noise;
	state.enable_colorbleed = view.enable_colorbleed;
	state.enable_scanlines = view.enable_scanlines;
	state.enable_blur = view.enable_blur;
	state.enable_glow = view.enable_glow;
	state.enable_fringing = view.enable_fringing;
	state.enable_aperture = view.enable_aperture;
}

export function syncGameViewViewportSizeFromHost(state: GameViewState, view: GameView): void {
	state.viewportSize.x = view.viewportSize.x;
	state.viewportSize.y = view.viewportSize.y;
}

export function applyGameViewStateToHost(state: GameViewState, view: GameView): void {
	view.crt_postprocessing_enabled = state.crt_postprocessing_enabled;
	view.enable_noise = state.enable_noise;
	view.enable_colorbleed = state.enable_colorbleed;
	view.enable_scanlines = state.enable_scanlines;
	view.enable_blur = state.enable_blur;
	view.enable_glow = state.enable_glow;
	view.enable_fringing = state.enable_fringing;
	view.enable_aperture = state.enable_aperture;
}
