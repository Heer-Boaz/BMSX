import type { KeyModifier } from './text';

/** Host UI pointer bits follow DOM button masks, independently of guest device words. */
export const enum PointerButton { Primary = 1, Secondary = 2, Auxiliary = 4 }

export type PointerButtons = {
	pressedButtons: number;
	justPressedButtons: number;
	justReleasedButtons: number;
};

/** One normalized logical canvas pointer; delivery is synchronous and producer-owned. */
export type PointerInputEvent = {
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
	readonly modifiers: KeyModifier;
	readonly timestamp: number;
};
