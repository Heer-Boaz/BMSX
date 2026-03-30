import { RenderSubmission } from '../backend/pipeline_interfaces';

export type EditorOverlayFrame = {
	width: number;
	height: number;
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commands: RenderSubmission[];
};

let pendingFrame: EditorOverlayFrame = null;

export function publishOverlayFrame(frame: EditorOverlayFrame): void {
	pendingFrame = frame;
}

export function hasPendingOverlayFrame(): boolean {
	return pendingFrame !== null;
}

export function consumeOverlayFrame(): EditorOverlayFrame {
	const frame = pendingFrame;
	pendingFrame = null;
	return frame;
}

export function clearOverlayFrame(): void {
	pendingFrame = null;
}
