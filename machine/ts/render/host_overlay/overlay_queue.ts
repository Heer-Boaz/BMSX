import type { Host2DSubmission } from '../shared/submissions';

export type HostOverlayFrame = {
	width: number;
	height: number;
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commands: Host2DSubmission[];
};

const HOST_OVERLAY_QUEUE_GLOBAL = '__bmsxHostOverlayQueue';

type HostOverlayQueueState = {
	pendingFrame: HostOverlayFrame;
};

type HostOverlayQueueGlobal = typeof globalThis & {
	__bmsxHostOverlayQueue?: HostOverlayQueueState;
};

function hostOverlayQueueState(): HostOverlayQueueState {
	const globalScope = globalThis as HostOverlayQueueGlobal;
	let state = globalScope[HOST_OVERLAY_QUEUE_GLOBAL];
	if (state === undefined) {
		state = { pendingFrame: null };
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
