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
import { EditorTextModel } from '../../ide/editor/model/text_model';
import type { RuntimeResource } from '../../ide/common/resource';
import {
	actionPromptState,
	closeActionPrompt,
	showActionPrompt,
} from '../../ide/workbench/contrib/modal/action_prompt';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';
import type { HostClock } from '../../hosts/common/clock';

const actionTestClock: HostClock = {
	now: () => 0,
	dateNow: () => 0,
	scheduleOnce: () => ({
		cancel: () => {},
		isActive: () => false,
	}),
};

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
		),
		'scenarioLab.run',
	);
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.none,
			enabledCommands('debugContinue'),
		),
		'debugContinue',
	);
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.ctrl,
			enabledCommands('scenarioLab.rerun'),
		),
		'scenarioLab.rerun',
	);
	assert.equal(
		resolveEditorCommandKeybinding(
			'F5',
			KeyModifier.shift,
			enabledCommands('scenarioLab.cancel'),
		),
		'scenarioLab.cancel',
	);
	assert.equal(EDITOR_COMMAND_KEYBINDING_LABELS.get('debugContinue'), 'F5');
	assert.equal(EDITOR_COMMAND_KEYBINDING_LABELS.get('scenarioLab.rerun'), 'CTRL/CMD+F5');
});

test('named workbench menu materializes one retained generic action bar', () => {
	assert.deepEqual(WORKBENCH_MENUS['scenarioLab.title'], [
		{ type: 'command', command: 'scenarioLab.run' },
		{ type: 'command', command: 'scenarioLab.rerun' },
		{ type: 'command', command: 'scenarioLab.cancel' },
	]);
	const actionBar = createWorkbenchActionBar('scenarioLab.title');
	const firstBounds = actionBar.items[0].bounds;
	layoutWorkbenchActionBar(actionBar, 200, 10, 20, text => text.length * 4);

	assert.deepEqual(actionBar.items.map(item => item.command), [
		'scenarioLab.run',
		'scenarioLab.rerun',
		'scenarioLab.cancel',
	]);
	assert.equal(actionBar.items[0].bounds, firstBounds);
	assert.equal(actionBar.items[2].bounds.right, 200);
	assert.equal(actionBar.items[0].bounds.top, 10);
	assert.equal(actionBar.items[0].bounds.bottom, 20);
});

test('a workbench action prompt retains the exact dirty working-copy batch', (t) => {
	const resource: RuntimeResource = {
		domain: 0,
		path: 'res/guard.aem',
		source: {
			resid: 'guard',
			type: 'aem',
			source_path: 'res/guard.aem',
		},
	};
	const model = new EditorTextModel(resource, 'aem', '{}');
	model.pushEditOperations([{ offset: 1, deleteLength: 0, text: ' ' }]);
	const workingCopies = [model];
	t.after(closeActionPrompt);
	configureFontVariant(actionTestClock, DEFAULT_FONT_VARIANT, 'aem');

	showActionPrompt('hot-resume', workingCopies);
	assert.strictEqual(actionPromptState.prompt!.workingCopies, workingCopies);
	assert.strictEqual(actionPromptState.prompt!.workingCopies[0], model);
});
