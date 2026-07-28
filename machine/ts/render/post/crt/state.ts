import type { CRTPipelineState, PresentPipelineState, RenderGraphPassContext } from '../../backend/backend';
import type { VideoPresenter } from '../../video_presenter';
import { DeviceQuantizeMode } from '../device_quantize/mode';

export function shouldExecuteAutoPresentPass(presenter: VideoPresenter): boolean {
	return !presenter.crt_postprocessing_enabled
		|| (!presenter.enable_noise
			&& !presenter.enable_colorbleed
			&& !presenter.enable_scanlines
			&& !presenter.enable_blur
			&& !presenter.enable_glow
			&& !presenter.enable_fringing
			&& !presenter.enable_aperture);
}

export function shouldExecuteAutoCrtPass(presenter: VideoPresenter): boolean {
	return presenter.crt_postprocessing_enabled
		&& (presenter.enable_noise
			|| presenter.enable_colorbleed
			|| presenter.enable_scanlines
			|| presenter.enable_blur
			|| presenter.enable_glow
			|| presenter.enable_fringing
			|| presenter.enable_aperture);
}


function currentFrameSourceTexture(ctx: RenderGraphPassContext, presenter: VideoPresenter) {
	return ctx.deviceColorEnabled && presenter.deviceQuantizeMode !== DeviceQuantizeMode.None ? ctx.getTex('device_color') : ctx.getTex('frame_color');
}

function presentationHistorySlot(index: 0 | 1): 'frame_history_a' | 'frame_history_b' {
	return index === 0 ? 'frame_history_a' : 'frame_history_b';
}

function presentedHistoryTexture(ctx: RenderGraphPassContext, presenter: VideoPresenter) {
	const historyIndex = presenter.commitPresentationFrame ? presenter.presentationHistoryDestinationIndex : presenter.presentationHistorySourceIndex;
	return ctx.getTex(presentationHistorySlot(historyIndex));
}

export function shouldUpdatePresentationHistoryA(presenter: VideoPresenter): boolean {
	return presenter.commitPresentationFrame && presenter.presentationHistoryDestinationIndex === 0;
}

export function shouldUpdatePresentationHistoryB(presenter: VideoPresenter): boolean {
	return presenter.commitPresentationFrame && presenter.presentationHistoryDestinationIndex === 1;
}

export function writePresentationHistoryPassState(ctx: RenderGraphPassContext, state: PresentPipelineState): void {
	const presenter = ctx.presenter as VideoPresenter;
	state.width = presenter.offscreenCanvasSize.x;
	state.height = presenter.offscreenCanvasSize.y;
	state.srcWidth = presenter.offscreenCanvasSize.x;
	state.srcHeight = presenter.offscreenCanvasSize.y;
	state.colorTex = currentFrameSourceTexture(ctx, presenter);
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
	const presenter = ctx.presenter as VideoPresenter;
	state.width = presenter.canvasSize.x;
	state.height = presenter.canvasSize.y;
	state.srcWidth = presenter.offscreenCanvasSize.x;
	state.srcHeight = presenter.offscreenCanvasSize.y;
	state.colorTex = presentedHistoryTexture(ctx, presenter);
}

export function createCrtPassState(): CRTPipelineState {
	return {
		width: 0,
		height: 0,
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
	const presenter = ctx.presenter as VideoPresenter;
	const applyCrt = presenter.crt_postprocessing_enabled;
	state.width = presenter.canvasSize.x;
	state.height = presenter.canvasSize.y;
	state.srcWidth = presenter.offscreenCanvasSize.x;
	state.srcHeight = presenter.offscreenCanvasSize.y;
	state.time = ctx.time;
	state.colorTex = presentedHistoryTexture(ctx, presenter);
	const options = state.options;
	options.applyNoise = applyCrt && presenter.enable_noise;
	options.applyColorBleed = applyCrt && presenter.enable_colorbleed;
	options.applyScanlines = applyCrt && presenter.enable_scanlines;
	options.applyBlur = applyCrt && presenter.enable_blur;
	options.applyGlow = applyCrt && presenter.enable_glow;
	options.applyFringing = applyCrt && presenter.enable_fringing;
	options.applyAperture = applyCrt && presenter.enable_aperture;
	options.noiseIntensity = presenter.noiseIntensity;
	options.colorBleed[0] = presenter.colorBleed[0];
	options.colorBleed[1] = presenter.colorBleed[1];
	options.colorBleed[2] = presenter.colorBleed[2];
	options.blurIntensity = presenter.blurIntensity;
	options.glowColor[0] = presenter.glowColor[0];
	options.glowColor[1] = presenter.glowColor[1];
	options.glowColor[2] = presenter.glowColor[2];
}
