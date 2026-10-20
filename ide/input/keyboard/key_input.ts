import { KeyModifier, type KeyInputEvent, type ModifierState } from '../../../hosts/common/input/text';

export function isKeyJustPressed(code: string, event: KeyInputEvent): boolean {
	return event.code === code && event.down && !event.repeat && !event.consumed;
}

export function isKeyDown(code: string, event: KeyInputEvent): boolean {
	return event.code === code && event.down && !event.consumed;
}

export function consumeIdeKey(code: string, event: KeyInputEvent): void {
	if (event.code === code) event.consumed = true;
}

export function isCtrlDown(input: ModifierState): boolean {
	return (input.modifiers & KeyModifier.ctrl) !== 0;
}

export function isShiftDown(input: ModifierState): boolean {
	return (input.modifiers & KeyModifier.shift) !== 0;
}

export function isAltDown(input: ModifierState): boolean {
	return (input.modifiers & KeyModifier.alt) !== 0;
}

export function isMetaDown(input: ModifierState): boolean {
	return (input.modifiers & KeyModifier.meta) !== 0;
}
