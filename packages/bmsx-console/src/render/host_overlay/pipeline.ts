import type { HostMenuPipelineState, HostOverlayPipelineState } from '../backend/backend';
import { consoleCore } from '../../core/console';
import type { Host2DSubmission } from '../shared/submissions';
import { consumeOverlayFrame, hasPendingOverlayFrame } from './overlay_queue';

const EMPTY_HOST_OVERLAY_COMMANDS: Host2DSubmission[] = [];

export function buildHostOverlayState(): HostOverlayPipelineState {
	const view = consoleCore.view;
	if (hasPendingOverlayFrame()) {
		const frame = consumeOverlayFrame();
		return {
			width: view.offscreenCanvasSize.x,
			height: view.offscreenCanvasSize.y,
			overlayWidth: frame.width,
			overlayHeight: frame.height,
			time: consoleCore.platform.clock.now() / 1000,
			delta: consoleCore.deltatime_seconds,
			commands: frame.commands,
		};
	}
	return {
		width: view.offscreenCanvasSize.x,
		height: view.offscreenCanvasSize.y,
		overlayWidth: view.viewportSize.x,
		overlayHeight: view.viewportSize.y,
		time: consoleCore.platform.clock.now() / 1000,
		delta: consoleCore.deltatime_seconds,
		commands: EMPTY_HOST_OVERLAY_COMMANDS,
	};
}

export function buildHostMenuState(): HostMenuPipelineState {
	const view = consoleCore.view;
	return {
		width: view.offscreenCanvasSize.x,
		height: view.offscreenCanvasSize.y,
		overlayWidth: view.viewportSize.x,
		overlayHeight: view.viewportSize.y,
		time: consoleCore.platform.clock.now() / 1000,
		delta: consoleCore.deltatime_seconds,
	};
}
