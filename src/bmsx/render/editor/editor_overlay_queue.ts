import { ConsoleRenderCommand } from '../../console/console_render_facade';

export type EditorOverlayFrame = {
	width: number;
	height: number;
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commands: ConsoleRenderCommand[];
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
