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
import { KeyModifier } from '../../hosts/common/input/text';
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
	const expected = WORKBENCH_MENUS['window.title'].map(item => item.command);
	const actionBar = createWorkbenchActionBar('window.title');
	const firstBounds = actionBar.items[0].bounds;
	layoutWorkbenchActionBar(actionBar, 200, 10, 20, text => text.length * 4, null, 0);

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
	assert.ok(actions.some(action => action.command === 'runtime.playback'));
	for (const command of ['stepFrameBack', 'stepFrame'] as const) {
		assert.ok(actions.some(action => action.command === command));
		assert.ok(WORKBENCH_MENUS['menubar.run'].some(item => item.type === 'command' && item.command === command));
	}
});

// Menu ownership is the contract: discover global windows here, manipulate a specific part at its chrome/tab/group.
test('Window menu keeps discovery without duplicating contextual placement and focus operations', () => {
	const windowMenu = WORKBENCH_MENUS['menubar.window'];
	for (const command of ['window.showAll', 'window.newEditor', 'window.restoreMinimized', 'workspace.hierarchy.toggle', 'workspace.details.toggle', 'workspace.resetLayout'] as const)
		assert.ok(windowMenu.some(item => item.type === 'command' && item.command === command));
	for (const command of ['window.move', 'window.resize', 'window.snapLeft', 'window.snapRight', 'window.maximize', 'window.restore', 'window.minimize', 'window.hide',
		'window.copyEditor', 'window.moveEditor', 'group.focusNext', 'group.focusTabs', 'group.focusPrevious', 'group.move', 'workspace.hierarchy.float', 'workspace.details.dock'] as const)
		assert.equal(windowMenu.some(item => item.type === 'command' && item.command === command), false);
	for (const command of ['window.move', 'window.resize', 'window.snapLeft', 'window.snapRight', 'window.maximize', 'window.restore', 'window.hide'] as const)
		assert.ok(WORKBENCH_MENUS['window.context'].some(item => item.type === 'command' && item.command === command));
	for (const command of ['window.copyEditor', 'window.moveEditor'] as const)
		assert.ok(WORKBENCH_MENUS['editorTabs.context'].some(item => item.type === 'command' && item.command === command));
});

test('routine tool menus expose one primary Source action rather than placement variants', () => {
	for (const id of ['editor.source.actions', 'behaviorLens.graph.actions', 'behaviorLens.stateGraph.actions', 'behaviorLens.properties.actions',
		'behaviorLens.node.context', 'behaviorLens.state.context', 'behaviorLens.edge.context', 'behaviorLens.property.context', 'aem.context'] as const) {
		assert.ok(WORKBENCH_MENUS[id].some(item => item.type === 'command' && item.command === 'editor.source'));
		assert.equal(WORKBENCH_MENUS[id].some(item => item.type === 'command' && item.command === 'editor.sourceToSide'), false);
	}
});
