import type { color } from '../shared/render_types';

export type OverlayRectCommand = {
	type: 'rect';
	kind: 'rect' | 'fill';
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	color: color;
};

export type OverlaySpriteCommand = {
	type: 'sprite';
	imgId: string;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	flipH: boolean;
	flipV: boolean;
	color: color | null;
};

export type OverlayCommand = OverlayRectCommand | OverlaySpriteCommand;

export type EditorOverlayFrame = {
	width: number;
	height: number;
	commands: OverlayCommand[];
};

let pendingFrame: EditorOverlayFrame | null = null;
let hasPendingCommands = false;

export function publishOverlayFrame(frame: EditorOverlayFrame | null): void {
	pendingFrame = frame;
	hasPendingCommands = !!frame && frame.commands.length > 0;
}

export function consumeOverlayFrame(): EditorOverlayFrame | null {
	const frame = pendingFrame;
	pendingFrame = null;
	hasPendingCommands = false;
	return frame;
}

export function overlayCommandsPending(): boolean {
	return hasPendingCommands;
}
