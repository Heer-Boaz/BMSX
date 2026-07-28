import type { HostMenuPipelineState, HostOverlayPipelineState, RenderGraphPassContext } from '../backend/backend';
import { consumeHostMenuFrame, consumeOverlayFrame } from './overlay_queue';

const EMPTY_HOST_MENU_KINDS = [];
const EMPTY_HOST_MENU_REFS = [];

export function createHostOverlayState(): HostOverlayPipelineState {
	return {
		width: 0,
		height: 0,
		overlayWidth: 0,
		overlayHeight: 0,
		time: 0,
		delta: 0,
		commands: [],
	};
}

export function writeHostOverlayState(ctx: RenderGraphPassContext, state: HostOverlayPipelineState): void {
	const presenter = ctx.presenter;
	const frame = consumeOverlayFrame();
	state.width = presenter.offscreenCanvasSize.x;
	state.height = presenter.offscreenCanvasSize.y;
	state.overlayWidth = frame.width;
	state.overlayHeight = frame.height;
	state.time = ctx.time;
	state.delta = ctx.delta;
	state.commands = frame.commands;
}

export function createHostMenuState(): HostMenuPipelineState {
	return {
		width: 0,
		height: 0,
		overlayWidth: 0,
		overlayHeight: 0,
		time: 0,
		delta: 0,
		commandKinds: EMPTY_HOST_MENU_KINDS,
		commandRefs: EMPTY_HOST_MENU_REFS,
		commandCount: 0,
	};
}

export function writeHostMenuState(ctx: RenderGraphPassContext, state: HostMenuPipelineState): void {
	const presenter = ctx.presenter;
	const frame = consumeHostMenuFrame();
	state.width = presenter.offscreenCanvasSize.x;
	state.height = presenter.offscreenCanvasSize.y;
	state.overlayWidth = presenter.viewportSize.x;
	state.overlayHeight = presenter.viewportSize.y;
	state.time = ctx.time;
	state.delta = ctx.delta;
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}
