import type {
	EditorCommandEnablement,
	EditorCommandId,
} from '../../common/commands';
import { KeyModifier } from '../../../hosts/common/input/text';
import { inputFocus, type InputFocusTarget } from '../focus';

export type EditorModifierConstraint = {
	readonly any?: KeyModifier;
	readonly required?: KeyModifier;
	readonly forbidden?: KeyModifier;
};

export const enum EditorKeybindingWeight {
	EditorContrib = 100,
	WorkbenchContrib = 200,
}

export type EditorKeybindingStroke = {
	readonly code: string;
	readonly modifiers: EditorModifierConstraint;
};

export type EditorKeybindingPress = {
	readonly code: string;
	readonly modifiers: KeyModifier;
};

export type EditorCommandKeybinding = EditorKeybindingStroke & {
	readonly command: EditorCommandId;
	readonly chord?: EditorKeybindingStroke;
	/** Applicability is distinct from command enablement (e.g. empty field history). */
	readonly when?: (target: InputFocusTarget | null) => boolean;
	readonly repeat?: boolean;
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
	{ code: 'Tab', command: 'suggest.accept', modifiers: NO_MODIFIERS, when: target => target?.getCommand('suggest.accept')?.isEnabled() === true },
	{ code: 'KeyZ', command: 'undo', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('undo') !== undefined, repeat: true },
	{ code: 'KeyZ', command: 'redo', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift, forbidden: KeyModifier.alt }, when: target => target?.getCommand('redo') !== undefined, repeat: true },
	{ code: 'KeyY', command: 'redo', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('redo') !== undefined, repeat: true },
	{ code: 'KeyS', command: 'save', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'KeyO', command: 'symbolSearch', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'KeyE', command: 'runtimeErrorFocus', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'Comma', command: 'symbolSearch', modifiers: { required: KeyModifier.ctrl | KeyModifier.alt } },
	{ code: 'Comma', command: 'symbolSearchGlobal', modifiers: { required: KeyModifier.alt, forbidden: PRIMARY_MODIFIER } },
	{ code: 'KeyH', command: 'callHierarchy', modifiers: { required: SHIFT_ALT_MODIFIERS, forbidden: PRIMARY_MODIFIER } },
];

const workbenchContribKeybindings: readonly EditorCommandKeybinding[] = [
	{ code: 'NumpadEnter', command: 'resources.openToSide', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('resources.openToSide') !== undefined },
	{ code: 'Enter', command: 'resources.openToSide', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('resources.openToSide') !== undefined },
	{ code: 'Backslash', command: 'group.splitRight', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'KeyK', command: 'group.splitDown', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, chord: { code: 'Backslash', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } } },
	{ code: 'KeyK', command: 'window.snapLeft', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, chord: { code: 'ArrowLeft', modifiers: NO_MODIFIERS } },
	{ code: 'KeyK', command: 'window.snapRight', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, chord: { code: 'ArrowRight', modifiers: NO_MODIFIERS } },
	{ code: 'KeyK', command: 'window.maximize', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, chord: { code: 'ArrowUp', modifiers: NO_MODIFIERS } },
	{ code: 'KeyK', command: 'window.restore', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, chord: { code: 'ArrowDown', modifiers: NO_MODIFIERS } },
	{ code: 'KeyW', command: 'tabs.close', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'Tab', command: 'tabs.next', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'Tab', command: 'tabs.previous', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift, forbidden: KeyModifier.alt } },
	{ code: 'F10', command: 'menubar.focus', modifiers: NO_MODIFIERS },
	{ code: 'KeyN', command: 'createResource', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS } },
	{ code: 'ContextMenu', command: 'contextMenu', modifiers: NO_MODIFIERS, when: target => target?.getCommand('contextMenu') !== undefined },
	{ code: 'F10', command: 'contextMenu', modifiers: { required: KeyModifier.shift, forbidden: PRIMARY_ALT_MODIFIERS }, when: target => target?.getCommand('contextMenu') !== undefined },
	{ code: 'ArrowLeft', command: 'navigateBack', modifiers: { required: KeyModifier.alt, forbidden: PRIMARY_MODIFIER | KeyModifier.shift } },
	{ code: 'ArrowRight', command: 'navigateForward', modifiers: { required: KeyModifier.alt, forbidden: PRIMARY_MODIFIER | KeyModifier.shift } },
	{ code: 'KeyP', command: 'commandPalette', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift, forbidden: KeyModifier.alt } },
	{ code: 'KeyF', command: 'list.find', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('list.find') !== undefined },
	{ code: 'KeyF', command: 'text.find', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('text.find') !== undefined },
	{ code: 'F3', command: 'text.findNext', modifiers: NO_MODIFIERS, when: target => target?.getCommand('text.findNext') !== undefined },
	{ code: 'F3', command: 'text.findPrevious', modifiers: { required: KeyModifier.shift, forbidden: PRIMARY_ALT_MODIFIERS }, when: target => target?.getCommand('text.findPrevious') !== undefined },
	{ code: 'KeyF', command: 'actorLab.find', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('actorLab.find') !== undefined },
	{ code: 'KeyD', command: 'behaviorLens.duplicateChild', modifiers: { any: PRIMARY_MODIFIER, forbidden: SHIFT_ALT_MODIFIERS }, when: target => target?.getCommand('behaviorLens.duplicateChild') !== undefined },
	{ code: 'Delete', command: 'behaviorLens.removeChild', modifiers: NO_MODIFIERS, when: target => target?.getCommand('behaviorLens.removeChild') !== undefined },
	{ code: 'F5', command: 'debugContinue', modifiers: NO_MODIFIERS },
	{ code: 'F7', command: 'stepFrame', modifiers: NO_MODIFIERS },
	{ code: 'F7', command: 'stepFrameBack', modifiers: { required: KeyModifier.shift, forbidden: PRIMARY_ALT_MODIFIERS } },
	{ code: 'F10', command: 'debugStepOver', modifiers: NO_MODIFIERS },
	{ code: 'F11', command: 'debugStepInto', modifiers: NO_MODIFIERS },
	{ code: 'F11', command: 'debugStepOut', modifiers: { required: KeyModifier.shift, forbidden: PRIMARY_ALT_MODIFIERS } },
	{ code: 'KeyS', command: 'hot-resume', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'KeyR', command: 'reboot', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'KeyT', command: 'theme-toggle', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.alt } },
	{ code: 'KeyL', command: 'filter', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift } },
	{ code: 'Comma', command: 'resourceSearch', modifiers: { any: PRIMARY_MODIFIER, forbidden: KeyModifier.alt } },
	{ code: 'KeyB', command: 'resources', modifiers: { any: PRIMARY_MODIFIER } },
	{ code: 'KeyE', command: 'resources.focus', modifiers: { any: PRIMARY_MODIFIER, required: KeyModifier.shift, forbidden: KeyModifier.alt } },
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
		const binding = bindings[bindingIndex];
		if (!registeredKeybindingCodes.has(binding.code)) {
			registeredKeybindingCodes.add(binding.code);
			editorKeybindingCodes.push(binding.code);
		}
		if (binding.chord !== undefined && !registeredKeybindingCodes.has(binding.chord.code)) {
			registeredKeybindingCodes.add(binding.chord.code);
			editorKeybindingCodes.push(binding.chord.code);
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
	commands: EditorCommandEnablement | undefined,
	target: InputFocusTarget | null = inputFocus.target,
	prefix?: EditorKeybindingPress,
): EditorCommandKeybinding | null {
	for (let groupIndex = EDITOR_DEFAULT_KEYBINDING_GROUPS.length - 1; groupIndex >= 0; groupIndex -= 1) {
		const bindings = EDITOR_DEFAULT_KEYBINDING_GROUPS[groupIndex].bindings;
		for (let bindingIndex = bindings.length - 1; bindingIndex >= 0; bindingIndex -= 1) {
			const binding = bindings[bindingIndex];
			if (prefix === undefined) {
				if (binding.code !== code || !matchesModifierConstraint(binding.modifiers, modifiers)) continue;
			} else {
				if (binding.chord === undefined || binding.code !== prefix.code || !matchesModifierConstraint(binding.modifiers, prefix.modifiers)
					|| binding.chord.code !== code || !matchesModifierConstraint(binding.chord.modifiers, modifiers)) continue;
			}
			const ownCommand = target?.getCommand(binding.command);
			if (ownCommand === undefined && commands === undefined) continue;
			if (binding.when !== undefined ? binding.when(target)
				: ownCommand !== undefined || commands!.isEnabled(binding.command, target)) return binding;
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
		case 'ArrowLeft': return 'LEFT';
		case 'ArrowRight': return 'RIGHT';
		case 'ArrowUp': return 'UP';
		case 'ArrowDown': return 'DOWN';
		default: return code.toUpperCase();
	}
}

function appendModifierLabel(label: string, modifier: string): string {
	return label.length === 0 ? modifier : `${label}+${modifier}`;
}

export function editorKeybindingStrokeLabel(binding: EditorKeybindingStroke): string {
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

export function editorKeybindingLabel(binding: EditorCommandKeybinding): string {
	const first = editorKeybindingStrokeLabel(binding);
	return binding.chord === undefined ? first : `${first}, ${editorKeybindingStrokeLabel(binding.chord)}`;
}

const editorCommandKeybindingLabels = new Map<EditorCommandId, string>();
// Clipboard shortcuts are dispatched by the host, not editor keybinding rules.
editorCommandKeybindingLabels.set('cut', 'CTRL/CMD+X');
editorCommandKeybindingLabels.set('copy', 'CTRL/CMD+C');
editorCommandKeybindingLabels.set('paste', 'CTRL/CMD+V');
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
