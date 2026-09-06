import type {
	EditorCommandEnablement,
	EditorCommandId,
} from '../../common/commands';
import { KeyModifier } from '../../../hosts/common/input/player';

export type EditorModifierConstraint = {
	readonly any?: KeyModifier;
	readonly required?: KeyModifier;
	readonly forbidden?: KeyModifier;
};

export const enum EditorKeybindingWeight {
	EditorContrib = 100,
	WorkbenchContrib = 200,
}

export type EditorCommandKeybinding = {
	readonly code: string;
	readonly command: EditorCommandId;
	readonly modifiers: EditorModifierConstraint;
};

export type EditorCommandKeybindingGroup = {
	readonly weight: number;
	readonly bindings: readonly EditorCommandKeybinding[];
};

const PRIMARY_MODIFIER = KeyModifier.ctrl | KeyModifier.meta;
const SHIFT_ALT_MODIFIERS = KeyModifier.shift | KeyModifier.alt;
const PRIMARY_ALT_MODIFIERS = PRIMARY_MODIFIER | KeyModifier.alt;
const ALL_MODIFIERS = PRIMARY_ALT_MODIFIERS | KeyModifier.shift;
const NO_MODIFIERS: EditorModifierConstraint = {
	forbidden: ALL_MODIFIERS,
};

const editorContribKeybindings: readonly EditorCommandKeybinding[] = [
	{ code: 'KeyO', command: 'symbolSearch', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'KeyE', command: 'runtimeErrorFocus', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'Comma', command: 'symbolSearch', modifiers: { required: KeyModifier.ctrl | KeyModifier.alt } },
	{ code: 'Comma', command: 'symbolSearchGlobal', modifiers: { required: KeyModifier.alt, forbidden: PRIMARY_MODIFIER } },
	{ code: 'KeyH', command: 'callHierarchy', modifiers: { required: SHIFT_ALT_MODIFIERS, forbidden: PRIMARY_MODIFIER } },
];

const workbenchContribKeybindings: readonly EditorCommandKeybinding[] = [
	{ code: 'F5', command: 'debugContinue', modifiers: NO_MODIFIERS },
	{ code: 'F10', command: 'debugStepOver', modifiers: NO_MODIFIERS },
	{ code: 'F11', command: 'debugStepInto', modifiers: NO_MODIFIERS },
	{ code: 'F11', command: 'debugStepOut', modifiers: { required: KeyModifier.shift, forbidden: PRIMARY_ALT_MODIFIERS } },
	{ code: 'KeyS', command: 'hot-resume', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'KeyR', command: 'reboot', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'KeyT', command: 'theme-toggle', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.alt } },
	{ code: 'KeyL', command: 'filter', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'Comma', command: 'resourceSearch', modifiers: { any: PRIMARY_MODIFIER, forbidden: KeyModifier.alt } },
	{ code: 'KeyB', command: 'resources', modifiers: { any: PRIMARY_MODIFIER } },
	{ code: 'KeyM', command: 'problems', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
];

const scenarioLabKeybindings: readonly EditorCommandKeybinding[] = [
	{ code: 'F5', command: 'scenarioLab.run', modifiers: NO_MODIFIERS },
	{ code: 'F5', command: 'scenarioLab.rerun', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'F5', command: 'scenarioLab.cancel', modifiers: { required: KeyModifier.shift, forbidden: PRIMARY_ALT_MODIFIERS } },
];

const editorDefaultKeybindingGroups: EditorCommandKeybindingGroup[] = [
	{
		weight: EditorKeybindingWeight.EditorContrib,
		bindings: editorContribKeybindings,
	},
	{
		weight: EditorKeybindingWeight.WorkbenchContrib,
		bindings: workbenchContribKeybindings,
	},
	{
		weight: EditorKeybindingWeight.WorkbenchContrib + 1,
		bindings: scenarioLabKeybindings,
	},
];
editorDefaultKeybindingGroups.sort((left, right) => left.weight - right.weight);

/** Higher-weight groups win; later applicable bindings within one group win. */
export const EDITOR_DEFAULT_KEYBINDING_GROUPS: readonly EditorCommandKeybindingGroup[]
	= editorDefaultKeybindingGroups;

const editorKeybindingCodes: string[] = [];
const registeredKeybindingCodes = new Set<string>();
for (let groupIndex = 0; groupIndex < EDITOR_DEFAULT_KEYBINDING_GROUPS.length; groupIndex += 1) {
	const group = EDITOR_DEFAULT_KEYBINDING_GROUPS[groupIndex];
	const bindings = group.bindings;
	for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
		const code = bindings[bindingIndex].code;
		if (!registeredKeybindingCodes.has(code)) {
			registeredKeybindingCodes.add(code);
			editorKeybindingCodes.push(code);
		}
	}
}

export const EDITOR_KEYBINDING_CODES: readonly string[] = editorKeybindingCodes;

function matchesModifierConstraint(
	constraint: EditorModifierConstraint,
	state: KeyModifier,
): boolean {
	return (constraint.any === undefined || (state & constraint.any) !== 0)
		&& (constraint.required === undefined
			|| (state & constraint.required) === constraint.required)
		&& (constraint.forbidden === undefined || (state & constraint.forbidden) === 0);
}

/** Resolves like VS Code: later rules at the highest sorted weight win. */
export function resolveEditorCommandKeybinding(
	code: string,
	modifiers: KeyModifier,
	commands: EditorCommandEnablement,
): EditorCommandId | null {
	for (let groupIndex = EDITOR_DEFAULT_KEYBINDING_GROUPS.length - 1; groupIndex >= 0; groupIndex -= 1) {
		const bindings = EDITOR_DEFAULT_KEYBINDING_GROUPS[groupIndex].bindings;
		for (let bindingIndex = bindings.length - 1; bindingIndex >= 0; bindingIndex -= 1) {
			const binding = bindings[bindingIndex];
			if (binding.code === code
				&& matchesModifierConstraint(binding.modifiers, modifiers)
				&& commands.isEnabled(binding.command)) {
				return binding.command;
			}
		}
	}
	return null;
}

function keyCodeLabel(code: string): string {
	if (code.startsWith('Key')) {
		return code.slice(3);
	}
	switch (code) {
		case 'Comma': return ',';
		case 'BracketLeft': return '[';
		case 'BracketRight': return ']';
		default: return code.toUpperCase();
	}
}

function appendModifierLabel(label: string, modifier: string): string {
	return label.length === 0 ? modifier : `${label}+${modifier}`;
}

export function editorKeybindingLabel(binding: EditorCommandKeybinding): string {
	let label = '';
	const any = binding.modifiers.any;
	if (any === PRIMARY_MODIFIER) {
		label = 'CTRL/CMD';
	}
	const required = binding.modifiers.required;
	if (required !== undefined) {
		if ((required & KeyModifier.ctrl) !== 0) label = appendModifierLabel(label, 'CTRL');
		if ((required & KeyModifier.meta) !== 0) label = appendModifierLabel(label, 'CMD');
		if ((required & KeyModifier.shift) !== 0) label = appendModifierLabel(label, 'SHIFT');
		if ((required & KeyModifier.alt) !== 0) label = appendModifierLabel(label, 'ALT');
	}
	return appendModifierLabel(label, keyCodeLabel(binding.code));
}

const editorCommandKeybindingLabels = new Map<EditorCommandId, string>();
for (let groupIndex = 0; groupIndex < EDITOR_DEFAULT_KEYBINDING_GROUPS.length; groupIndex += 1) {
	const group = EDITOR_DEFAULT_KEYBINDING_GROUPS[groupIndex];
	const bindings = group.bindings;
	for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
		const binding = bindings[bindingIndex];
		editorCommandKeybindingLabels.set(binding.command, editorKeybindingLabel(binding));
	}
}

export const EDITOR_COMMAND_KEYBINDING_LABELS: ReadonlyMap<EditorCommandId, string>
	= editorCommandKeybindingLabels;
