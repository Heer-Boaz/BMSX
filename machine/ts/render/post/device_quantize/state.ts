import type { RenderGraphPassContext, RenderPassStateRegistry, TextureHandle } from '../../backend/backend';
import type { GameView } from '../../gameview';
import { DeviceQuantizeMode } from './mode';

export function createDeviceQuantizeState(): RenderPassStateRegistry['device_quantize'] {
	return {
		width: 0,
		height: 0,
		baseWidth: 0,
		baseHeight: 0,
		colorTex: null as TextureHandle,
		deviceQuantizeMode: DeviceQuantizeMode.None,
	};
}

export function writeDeviceQuantizeState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['device_quantize']): void {
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.baseWidth = ctx.view.viewportSize.x;
	state.baseHeight = ctx.view.viewportSize.y;
	state.colorTex = ctx.getTex('frame_color');
	state.deviceQuantizeMode = (ctx.view as GameView).deviceQuantizeMode;
}
