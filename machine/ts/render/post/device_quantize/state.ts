import type { RenderGraphPassContext, RenderPassStateRegistry, TextureHandle } from '../../backend/backend';
import type { GameView } from '../../gameview';
import { DeviceQuantizeMode } from './mode';
import { DEVICE_QUANTIZE_LUTS, type DeviceQuantizeLuts } from './lut';

export function createDeviceQuantizeState(): RenderPassStateRegistry['device_quantize'] {
	return {
		width: 0,
		height: 0,
		colorTex: null as TextureHandle,
		luts: null as DeviceQuantizeLuts,
		configurationRevision: -1,
	};
}

export function writeDeviceQuantizeState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['device_quantize']): boolean {
	const view = ctx.view as GameView;
	const configurationRevision = view.deviceQuantizeConfigurationRevision;
	if (state.configurationRevision === configurationRevision) {
		return false;
	}
	state.width = view.offscreenCanvasSize.x;
	state.height = view.offscreenCanvasSize.y;
	state.colorTex = ctx.getTex('frame_color');
	state.luts = DEVICE_QUANTIZE_LUTS[view.deviceQuantizeMode - DeviceQuantizeMode.Rgb565];
	state.configurationRevision = configurationRevision;
	return true;
}
