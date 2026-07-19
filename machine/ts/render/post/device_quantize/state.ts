import type { RenderGraphPassContext, RenderPassStateRegistry, TextureHandle } from '../../backend/backend';
import type { GameView } from '../../gameview';
import { DEVICE_QUANTIZE_LEVELS, DeviceQuantizeMode } from './mode';

export function createDeviceQuantizeState(): RenderPassStateRegistry['device_quantize'] {
	return {
		width: 0,
		height: 0,
		baseWidth: 0,
		baseHeight: 0,
		colorTex: null as TextureHandle,
		deviceQuantizeMode: DeviceQuantizeMode.None,
		quantizeLevels: DEVICE_QUANTIZE_LEVELS[DeviceQuantizeMode.None],
		sourcePixelScaleX: 0,
		sourcePixelScaleY: 0,
		sourcePixelTargetHeight: 0,
	};
}

export function writeDeviceQuantizeState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['device_quantize']): void {
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.baseWidth = ctx.view.viewportSize.x;
	state.baseHeight = ctx.view.viewportSize.y;
	state.colorTex = ctx.getTex('frame_color');
	const view = ctx.view as GameView;
	const scale = state.width / state.baseWidth;
	state.deviceQuantizeMode = view.deviceQuantizeMode;
	state.quantizeLevels = view.deviceQuantizeLevels;
	state.sourcePixelScaleX = (state.baseWidth - 1) / state.width;
	state.sourcePixelScaleY = (state.baseHeight - 1) / (state.baseHeight * scale);
	state.sourcePixelTargetHeight = state.baseHeight * scale;
}
