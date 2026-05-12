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

let pendingFrame: HostOverlayFrame = null;

export function publishOverlayFrame(frame: HostOverlayFrame): void {
	pendingFrame = frame;
}

export function hasPendingOverlayFrame(): boolean {
	return pendingFrame !== null;
}

export function consumeOverlayFrame(): HostOverlayFrame {
	const frame = pendingFrame;
	pendingFrame = null;
	return frame;
}

export function clearOverlayFrame(): void {
	pendingFrame = null;
}
