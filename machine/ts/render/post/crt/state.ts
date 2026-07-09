import type { CRTPipelineState, PresentPipelineState, RenderGraphPassContext } from '../../backend/backend';
import type { GameView } from '../../gameview';

export function shouldExecuteAutoPresentPass(view: GameView): boolean {
	return !view.crt_postprocessing_enabled
		|| (!view.enable_noise
			&& !view.enable_colorbleed
			&& !view.enable_scanlines
			&& !view.enable_blur
			&& !view.enable_glow
			&& !view.enable_fringing
			&& !view.enable_aperture);
}

export function shouldExecuteAutoCrtPass(view: GameView): boolean {
	return view.crt_postprocessing_enabled
		&& (view.enable_noise
			|| view.enable_colorbleed
			|| view.enable_scanlines
			|| view.enable_blur
			|| view.enable_glow
			|| view.enable_fringing
			|| view.enable_aperture);
}


function currentFrameSourceTexture(ctx: RenderGraphPassContext, view: GameView) {
	return ctx.deviceColorEnabled && view.dither_type !== 0 ? ctx.getTex('device_color') : ctx.getTex('frame_color');
}

function presentationHistorySlot(index: 0 | 1): 'frame_history_a' | 'frame_history_b' {
	return index === 0 ? 'frame_history_a' : 'frame_history_b';
}

function presentedHistoryTexture(ctx: RenderGraphPassContext, view: GameView) {
	const historyIndex = view.commitPresentationFrame ? view.presentationHistoryDestinationIndex : view.presentationHistorySourceIndex;
	return ctx.getTex(presentationHistorySlot(historyIndex));
}

export function shouldUpdatePresentationHistoryA(view: GameView): boolean {
	return view.commitPresentationFrame && view.presentationHistoryDestinationIndex === 0;
}

export function shouldUpdatePresentationHistoryB(view: GameView): boolean {
	return view.commitPresentationFrame && view.presentationHistoryDestinationIndex === 1;
}

export function writePresentationHistoryPassState(ctx: RenderGraphPassContext, state: PresentPipelineState): void {
	const view = ctx.view as GameView;
	state.width = view.offscreenCanvasSize.x;
	state.height = view.offscreenCanvasSize.y;
	state.srcWidth = view.offscreenCanvasSize.x;
	state.srcHeight = view.offscreenCanvasSize.y;
	state.colorTex = currentFrameSourceTexture(ctx, view);
}

export function createPresentPassState(): PresentPipelineState {
	return {
		width: 0,
		height: 0,
		srcWidth: 0,
		srcHeight: 0,
		colorTex: null,
	};
}

export function writePresentPassState(ctx: RenderGraphPassContext, state: PresentPipelineState): void {
	const view = ctx.view as GameView;
	state.width = view.canvasSize.x;
	state.height = view.canvasSize.y;
	state.srcWidth = view.offscreenCanvasSize.x;
	state.srcHeight = view.offscreenCanvasSize.y;
	state.colorTex = presentedHistoryTexture(ctx, view);
}

export function createCrtPassState(): CRTPipelineState {
	return {
		width: 0,
		height: 0,
		baseWidth: 0,
		baseHeight: 0,
		srcWidth: 0,
		srcHeight: 0,
		time: 0,
		colorTex: null,
		options: {
			applyNoise: false,
			noiseIntensity: 0,
			applyColorBleed: false,
			colorBleed: [0, 0, 0],
			applyScanlines: false,
			applyBlur: false,
			applyGlow: false,
			applyFringing: false,
			applyAperture: false,
			blurIntensity: 0,
			glowColor: [0, 0, 0],
		},
	};
}

export function writeCrtPassState(ctx: RenderGraphPassContext, state: CRTPipelineState): void {
	const view = ctx.view as GameView;
	const applyCrt = view.crt_postprocessing_enabled;
	state.width = view.canvasSize.x;
	state.height = view.canvasSize.y;
	state.baseWidth = view.viewportSize.x;
	state.baseHeight = view.viewportSize.y;
	state.srcWidth = view.offscreenCanvasSize.x;
	state.srcHeight = view.offscreenCanvasSize.y;
	state.time = ctx.time;
	state.colorTex = presentedHistoryTexture(ctx, view);
	const options = state.options;
	options.applyNoise = applyCrt && view.enable_noise;
	options.applyColorBleed = applyCrt && view.enable_colorbleed;
	options.applyScanlines = applyCrt && view.enable_scanlines;
	options.applyBlur = applyCrt && view.enable_blur;
	options.applyGlow = applyCrt && view.enable_glow;
	options.applyFringing = applyCrt && view.enable_fringing;
	options.applyAperture = applyCrt && view.enable_aperture;
	options.noiseIntensity = view.noiseIntensity;
	options.colorBleed[0] = view.colorBleed[0];
	options.colorBleed[1] = view.colorBleed[1];
	options.colorBleed[2] = view.colorBleed[2];
	options.blurIntensity = view.blurIntensity;
	options.glowColor[0] = view.glowColor[0];
	options.glowColor[1] = view.glowColor[1];
	options.glowColor[2] = view.glowColor[2];
}
