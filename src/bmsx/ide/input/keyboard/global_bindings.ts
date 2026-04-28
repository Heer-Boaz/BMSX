import type { Runtime } from '../../../machine/runtime/runtime';
import type { EditorCommandId } from '../../common/commands';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import { handleEscapeKey } from './modal_input';
import { ESCAPE_KEY } from '../../common/constants';

type ModifierKey = 'ctrl' | 'meta' | 'shift' | 'alt';

type ModifierConstraint = {
	readonly anyOf?: readonly ModifierKey[];
	readonly allOf?: readonly ModifierKey[];
	readonly noneOf?: readonly ModifierKey[];
};

type ModifierState = Readonly<Record<ModifierKey, boolean>>;

type CommandKeyBinding = {
	readonly code: string;
	readonly command: EditorCommandId;
	readonly modifiers: ModifierConstraint;
};

const editorGlobalKeyBindings: readonly CommandKeyBinding[] = [
	{ code: 'KeyS', command: 'hot-resume', modifiers: { anyOf: ['ctrl', 'meta'], allOf: ['shift'] } },
	{ code: 'KeyR', command: 'reboot', modifiers: { anyOf: ['ctrl', 'meta'], allOf: ['shift'] } },
	{ code: 'KeyT', command: 'theme-toggle', modifiers: { anyOf: ['ctrl', 'meta'], allOf: ['alt'] } },
	{ code: 'KeyO', command: 'symbolSearch', modifiers: { anyOf: ['ctrl', 'meta'], allOf: ['shift'] } },
	{ code: 'KeyL', command: 'filter', modifiers: { anyOf: ['ctrl', 'meta'], allOf: ['shift'] } },
	{ code: 'Comma', command: 'resourceSearch', modifiers: { anyOf: ['ctrl', 'meta'], noneOf: ['alt'] } },
	{ code: 'KeyE', command: 'runtimeErrorFocus', modifiers: { anyOf: ['ctrl', 'meta'], noneOf: ['shift', 'alt'] } },
	{ code: 'Comma', command: 'symbolSearch', modifiers: { allOf: ['ctrl', 'alt'] } },
	{ code: 'KeyB', command: 'resources', modifiers: { anyOf: ['ctrl', 'meta'] } },
	{ code: 'KeyM', command: 'problems', modifiers: { anyOf: ['ctrl', 'meta'], allOf: ['shift'] } },
	{ code: 'Comma', command: 'symbolSearchGlobal', modifiers: { allOf: ['alt'], noneOf: ['ctrl', 'meta'] } },
];

function handleEscapeBinding(): boolean {
	if (!isKeyJustPressed(ESCAPE_KEY) || !handleEscapeKey()) {
		return false;
	}
	consumeIdeKey(ESCAPE_KEY);
	return true;
}

function getModifierState(): ModifierState {
	return {
		ctrl: isCtrlDown(),
		meta: isMetaDown(),
		shift: isShiftDown(),
		alt: isAltDown(),
	};
}

function matchesEveryModifier(modifiers: readonly ModifierKey[] | undefined, state: ModifierState): boolean {
	if (!modifiers) {
		return true;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		if (!state[modifiers[index]]) {
			return false;
		}
	}
	return true;
}

function matchesAnyModifier(modifiers: readonly ModifierKey[] | undefined, state: ModifierState): boolean {
	if (!modifiers) {
		return true;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		if (state[modifiers[index]]) {
			return true;
		}
	}
	return false;
}

function rejectsForbiddenModifier(modifiers: readonly ModifierKey[] | undefined, state: ModifierState): boolean {
	if (!modifiers) {
		return false;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		if (state[modifiers[index]]) {
			return true;
		}
	}
	return false;
}

function matchesModifierConstraint(constraint: ModifierConstraint, state: ModifierState): boolean {
	return matchesAnyModifier(constraint.anyOf, state)
		&& matchesEveryModifier(constraint.allOf, state)
		&& !rejectsForbiddenModifier(constraint.noneOf, state);
}

function handleCommandKeyBinding(runtime: Runtime, binding: CommandKeyBinding, state: ModifierState): boolean {
	if (!isKeyJustPressed(binding.code) || !matchesModifierConstraint(binding.modifiers, state)) {
		return false;
	}
	consumeIdeKey(binding.code);
	runtime.editor.commands.execute(binding.command);
	return true;
}

export function handleEditorGlobalBindings(runtime: Runtime): boolean {
	if (handleEscapeBinding()) {
		return true;
	}
	const state = getModifierState();
	for (let index = 0; index < editorGlobalKeyBindings.length; index += 1) {
		if (handleCommandKeyBinding(runtime, editorGlobalKeyBindings[index], state)) {
			return true;
		}
	}
	return false;
}
