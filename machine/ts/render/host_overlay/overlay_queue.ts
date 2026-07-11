import type { Host2DKind, Host2DRef, Host2DSubmission } from '../shared/submissions';

export type HostOverlayFrame = {
	width: number;
	height: number;
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commands: Host2DSubmission[];
};

export type HostMenuFrame = {
	commandKinds: readonly Host2DKind[];
	commandRefs: readonly Host2DRef[];
	commandCount: number;
};

const HOST_OVERLAY_QUEUE_GLOBAL = '__bmsxHostOverlayQueue';

type HostOverlayQueueState = {
	pendingFrame: HostOverlayFrame;
	pendingMenuFrame: HostMenuFrame;
};

type HostOverlayQueueGlobal = typeof globalThis & {
	__bmsxHostOverlayQueue?: HostOverlayQueueState;
};

function hostOverlayQueueState(): HostOverlayQueueState {
	const globalScope = globalThis as HostOverlayQueueGlobal;
	let state = globalScope[HOST_OVERLAY_QUEUE_GLOBAL];
	if (state === undefined) {
		state = { pendingFrame: null, pendingMenuFrame: null };
		globalScope[HOST_OVERLAY_QUEUE_GLOBAL] = state;
	}
	return state;
}

export function publishOverlayFrame(frame: HostOverlayFrame): void {
	hostOverlayQueueState().pendingFrame = frame;
}

export function hasPendingOverlayFrame(): boolean {
	return hostOverlayQueueState().pendingFrame !== null;
}

export function consumeOverlayFrame(): HostOverlayFrame {
	const state = hostOverlayQueueState();
	const frame = state.pendingFrame;
	state.pendingFrame = null;
	return frame;
}

export function clearOverlayFrame(): void {
	hostOverlayQueueState().pendingFrame = null;
}

export function publishHostMenuFrame(frame: HostMenuFrame): void {
	hostOverlayQueueState().pendingMenuFrame = frame;
}

export function hasPendingHostMenuFrame(): boolean {
	return hostOverlayQueueState().pendingMenuFrame !== null;
}

export function consumeHostMenuFrame(): HostMenuFrame {
	const state = hostOverlayQueueState();
	const frame = state.pendingMenuFrame;
	state.pendingMenuFrame = null;
	return frame;
}

export function clearHostMenuFrame(): void {
	hostOverlayQueueState().pendingMenuFrame = null;
}
