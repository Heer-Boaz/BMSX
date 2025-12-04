import type { RenderSubmission } from '../gameview';

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

export function consumeOverlayFrame(): EditorOverlayFrame {
	const frame = pendingFrame;
	pendingFrame = null;
	return frame;
}
