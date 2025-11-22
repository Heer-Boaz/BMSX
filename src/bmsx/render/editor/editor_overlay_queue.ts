import type { ImgRenderSubmission, RectRenderSubmission } from '../shared/render_types';

export type OverlayCommand = RectRenderSubmission | ImgRenderSubmission;

export type EditorOverlayFrame = {
	width: number;
	height: number;
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commands: OverlayCommand[];
};

let pendingFrame: EditorOverlayFrame | null = null;

export function publishOverlayFrame(frame: EditorOverlayFrame | null): void {
	pendingFrame = frame;
}

export function consumeOverlayFrame(): EditorOverlayFrame | null {
	const frame = pendingFrame;
	pendingFrame = null;
	return frame;
}
