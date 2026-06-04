import type { HostMenuPipelineState, HostOverlayPipelineState, RenderGraphPassContext } from '../backend/backend';
import type { Host2DSubmission } from '../shared/submissions';
import { consumeOverlayFrame, hasPendingOverlayFrame } from './overlay_queue';

const EMPTY_HOST_OVERLAY_COMMANDS: Host2DSubmission[] = [];

export function buildHostOverlayState(ctx: RenderGraphPassContext): HostOverlayPipelineState {
	const view = ctx.view;
	if (hasPendingOverlayFrame()) {
		const frame = consumeOverlayFrame();
		return {
			width: view.offscreenCanvasSize.x,
			height: view.offscreenCanvasSize.y,
			overlayWidth: frame.width,
			overlayHeight: frame.height,
			time: ctx.time,
			delta: ctx.delta,
			commands: frame.commands,
		};
	}
	return {
		width: view.offscreenCanvasSize.x,
		height: view.offscreenCanvasSize.y,
		overlayWidth: view.viewportSize.x,
		overlayHeight: view.viewportSize.y,
		time: ctx.time,
		delta: ctx.delta,
		commands: EMPTY_HOST_OVERLAY_COMMANDS,
	};
}

export function buildHostMenuState(ctx: RenderGraphPassContext): HostMenuPipelineState {
	const view = ctx.view;
	return {
		width: view.offscreenCanvasSize.x,
		height: view.offscreenCanvasSize.y,
		overlayWidth: view.viewportSize.x,
		overlayHeight: view.viewportSize.y,
		time: ctx.time,
		delta: ctx.delta,
	};
}
