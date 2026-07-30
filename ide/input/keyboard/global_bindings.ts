import type { IdeCommandController } from '../../commands/controller';
import type { EditorCommandId } from '../../common/commands';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import { handleEscapeKey } from './modal_input';
import { ESCAPE_KEY } from '../../common/constants';
import type { PlayerInput } from '../../../hosts/common/input/player';

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

function handleEscapeBinding(playerInput: PlayerInput): boolean {
	if (!isKeyJustPressed(ESCAPE_KEY, playerInput) || !handleEscapeKey()) {
		return false;
	}
	consumeIdeKey(ESCAPE_KEY, playerInput);
	return true;
}

function getModifierState(playerInput: PlayerInput): ModifierState {
	return {
		ctrl: isCtrlDown(playerInput),
		meta: isMetaDown(playerInput),
		shift: isShiftDown(playerInput),
		alt: isAltDown(playerInput),
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

function handleCommandKeyBinding(playerInput: PlayerInput, commands: IdeCommandController, binding: CommandKeyBinding, state: ModifierState): boolean {
	if (!isKeyJustPressed(binding.code, playerInput) || !matchesModifierConstraint(binding.modifiers, state)) {
		return false;
	}
	consumeIdeKey(binding.code, playerInput);
	commands.execute(binding.command);
	return true;
}

export function handleEditorGlobalBindings(playerInput: PlayerInput, commands: IdeCommandController): boolean {
	if (handleEscapeBinding(playerInput)) {
		return true;
	}
	const state = getModifierState(playerInput);
	for (let index = 0; index < editorGlobalKeyBindings.length; index += 1) {
		if (handleCommandKeyBinding(playerInput, commands, editorGlobalKeyBindings[index], state)) {
			return true;
		}
	}
	return false;
}
