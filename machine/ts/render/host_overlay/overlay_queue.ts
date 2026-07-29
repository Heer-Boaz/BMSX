import type { Host2DKind, Host2DRef } from './commands';

export type HostOverlayFrame = {
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commandKinds: readonly Host2DKind[];
	commandRefs: readonly Host2DRef[];
	commandCount: number;
};

export type HostMenuFrame = {
	commandKinds: readonly Host2DKind[];
	commandRefs: readonly Host2DRef[];
	commandCount: number;
};

let pendingFrame: HostOverlayFrame;
let hasPendingFrame = false;
let pendingMenuFrame: HostMenuFrame;
let hasPendingMenuFrame = false;

export function publishOverlayFrame(frame: HostOverlayFrame): void {
	pendingFrame = frame;
	hasPendingFrame = true;
}

export function hasPendingOverlayFrame(): boolean {
	return hasPendingFrame;
}

export function consumeOverlayFrame(): HostOverlayFrame {
	hasPendingFrame = false;
	return pendingFrame;
}

export function clearOverlayFrame(): void {
	hasPendingFrame = false;
}

export function publishHostMenuFrame(frame: HostMenuFrame): void {
	pendingMenuFrame = frame;
	hasPendingMenuFrame = true;
}

export function hasPendingHostMenuFrame(): boolean {
	return hasPendingMenuFrame;
}

export function consumeHostMenuFrame(): HostMenuFrame {
	hasPendingMenuFrame = false;
	return pendingMenuFrame;
}

export function clearHostMenuFrame(): void {
	hasPendingMenuFrame = false;
}
