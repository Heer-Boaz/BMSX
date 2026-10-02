import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	EditorCommandEnablement,
	EditorCommandId,
} from '../../ide/common/commands';
import {
	EDITOR_COMMAND_KEYBINDING_LABELS,
	resolveEditorCommandKeybinding,
} from '../../ide/input/keyboard/command_keybindings';
import { KeyModifier } from '../../hosts/common/input/player';
import {
	createWorkbenchActionBar,
	layoutWorkbenchActionBar,
} from '../../ide/workbench/ui/action_bar';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';
function enabledCommands(...enabled: EditorCommandId[]): EditorCommandEnablement {
	const commands = new Set(enabled);
	return {
		isEnabled: command => commands.has(command),
	};
}

test('weighted command keybindings resolve the contextual Scenario Lab F5 action', () => {
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.none,
			enabledCommands('debugContinue', 'scenarioLab.run'),
		)!.command,
		'scenarioLab.run',
	);
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.none,
			enabledCommands('debugContinue'),
		)!.command,
		'debugContinue',
	);
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.ctrl,
			enabledCommands('scenarioLab.rerun'),
		)!.command,
		'scenarioLab.rerun',
	);
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.shift,
			enabledCommands('scenarioLab.cancel'),
		)!.command,
		'scenarioLab.cancel',
	);
	assert.equal(EDITOR_COMMAND_KEYBINDING_LABELS.get('debugContinue'), 'F5');
	assert.equal(EDITOR_COMMAND_KEYBINDING_LABELS.get('scenarioLab.rerun'), 'CTRL/CMD+F5');
});

test('named workbench menu materializes one retained generic action bar', () => {
	const expected = WORKBENCH_MENUS['scenarioLab.title'].map(item => item.command);
	const actionBar = createWorkbenchActionBar('scenarioLab.title');
	const firstBounds = actionBar.items[0].bounds;
	layoutWorkbenchActionBar(actionBar, 200, 10, 20, text => text.length * 4, null);

	assert.deepEqual(actionBar.items.map(item => item.command), expected);
	assert.equal(actionBar.items[0].bounds, firstBounds);
	assert.equal(actionBar.items.at(-1)!.bounds.right, 200);
	assert.equal(actionBar.items[0].bounds.top, 10);
	assert.equal(actionBar.items[0].bounds.bottom, 20);
});

test('game frame controls share commands and use distinct non-repeating Studio keybindings', () => {
	const commands = enabledCommands('stepFrame', 'stepFrameBack');
	assert.equal(resolveEditorCommandKeybinding('F7', KeyModifier.none, commands)?.command, 'stepFrame');
	assert.equal(resolveEditorCommandKeybinding('F7', KeyModifier.shift, commands)?.command, 'stepFrameBack');
	assert.notEqual(resolveEditorCommandKeybinding('F7', KeyModifier.none, commands)?.repeat, true);
	assert.notEqual(resolveEditorCommandKeybinding('F7', KeyModifier.shift, commands)?.repeat, true);
	assert.equal(resolveEditorCommandKeybinding('F7', KeyModifier.ctrl, commands), null);
	const actions = createWorkbenchActionBar('runtime.title').items;
	assert.ok(actions.some(action => action.command === 'pause'));
	for (const command of ['stepFrameBack', 'stepFrame'] as const) {
		assert.ok(actions.some(action => action.command === command));
		assert.ok(WORKBENCH_MENUS['menubar.run'].some(item => item.type === 'command' && item.command === command));
	}
});
