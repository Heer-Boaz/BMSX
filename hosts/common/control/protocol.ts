/** User I/O only. No machine, editor-model or command-service access. */
export type HostControlInputEvent =
	| { type: 'key'; code: string; down: boolean }
	| { type: 'pointer'; x: number; y: number }
	| { type: 'button'; button: 'primary' | 'secondary' | 'aux' | 'back' | 'forward'; down: boolean }
	| { type: 'wheel'; deltaY: number };

export type HostControlRequest = { id: number } & (
	| { execute: 'input'; events: readonly HostControlInputEvent[] }
	| { execute: 'capture' }
	| { execute: 'wait'; frames: number }
	| { execute: 'clipboard-set'; text: string }
	| { execute: 'clipboard-get' }
	| { execute: 'quit' }
);

export interface HostControlCapture {
	presentationFrame: number;
	width: number;
	height: number;
	path: string;
}
