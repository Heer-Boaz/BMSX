import type { KeyModifier } from './text';

export type PointerCursor = 'default' | 'col-resize' | 'row-resize' | 'ew-resize' | 'ns-resize' | 'nwse-resize' | 'nesw-resize';

/** Host UI pointer bits follow DOM button masks, independently of guest device words. */
export const enum PointerButton { Primary = 1, Secondary = 2, Auxiliary = 4 }

export type PointerButtons = {
	pressedButtons: number;
	justPressedButtons: number;
	justReleasedButtons: number;
};

/** Contact identity survives UI delivery. Guest attachment aggregation is a
 * separate device boundary; two fingers must never become one UI drag. */
export type PointerInputEvent = {
	readonly pointerId: number;
	readonly pointerType: string;
	readonly x: number;
	readonly y: number;
	readonly buttons: number;
	readonly pressedButtons: number;
	readonly releasedButtons: number;
	readonly cancelledButtons: number;
	readonly modifiers: KeyModifier;
	readonly spaceDown: boolean;
	readonly timestamp: number;
};

/** Host UI wheel movement in logical steps; positive axes scroll right/down. */
export type WheelInputEvent = {
	readonly x: number;
	readonly y: number;
	readonly deltaX: number;
	readonly deltaY: number;
	/** Guest attachment logical steps, distinct from UI scrolling units. */
	readonly attachmentDeltaY: number;
	readonly modifiers: KeyModifier;
	readonly timestamp: number;
};
