import type { CRTPipelineState, RenderGraphPassContext } from '../../backend/backend';
import type { GameView } from '../../gameview';

const crtPassState: CRTPipelineState = {
	width: 0,
	height: 0,
	baseWidth: 0,
	baseHeight: 0,
	colorTex: null,
	options: {
		enableNoise: false,
		noiseIntensity: 0,
		enableColorBleed: false,
		colorBleed: [0, 0, 0],
		enableScanlines: false,
		enableBlur: false,
		enableGlow: false,
		enableFringing: false,
		enableAperture: false,
		blurIntensity: 0,
		glowColor: [0, 0, 0],
	},
};

export function buildCrtPassState(ctx: RenderGraphPassContext): CRTPipelineState {
	const view = ctx.view as GameView;
	const applyCrt = view.crt_postprocessing_enabled;
	crtPassState.width = view.offscreenCanvasSize.x;
	crtPassState.height = view.offscreenCanvasSize.y;
	crtPassState.baseWidth = view.viewportSize.x;
	crtPassState.baseHeight = view.viewportSize.y;
	crtPassState.colorTex = ctx.deviceColorEnabled && view.dither_type !== 0 ? ctx.getTex('device_color') : ctx.getTex('frame_color');
	const options = crtPassState.options;
	options.enableNoise = applyCrt && view.enable_noise;
	options.enableColorBleed = applyCrt && view.enable_colorbleed;
	options.enableScanlines = applyCrt && view.enable_scanlines;
	options.enableBlur = applyCrt && view.enable_blur;
	options.enableGlow = applyCrt && view.enable_glow;
	options.enableFringing = applyCrt && view.enable_fringing;
	options.enableAperture = applyCrt && view.enable_aperture;
	options.noiseIntensity = view.noiseIntensity;
	options.colorBleed = view.colorBleed;
	options.blurIntensity = view.blurIntensity;
	options.glowColor = view.glowColor;
	return crtPassState;
}
