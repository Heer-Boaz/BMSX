import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EDITOR_COMMAND_PRESENTATION, editorCommandTitle } from '../../ide/commands/catalog';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';

test('tool command categories are independent of menu placement and compact titles', () => {
	for (const [command, category] of [
		['behaviorLens', 'Behavior Lens'],
		['sceneEditor', 'Scene Editor'],
		['scenarioLab', 'Scenario Lab'],
	] as const) {
		assert.ok(WORKBENCH_MENUS['menubar.view'].some(item => item.type === 'command' && item.command === command));
		assert.equal(EDITOR_COMMAND_PRESENTATION[command].category, category);
		assert.equal(editorCommandTitle(command, false), 'Open', 'palette uses the category-qualified action');
		assert.equal(editorCommandTitle(command, false, true), category, 'compact View menu names the tool, not three indistinguishable Open items');
	}
	assert.equal(editorCommandTitle('sceneEditor.source', false), 'Open Source');
	assert.equal(createWorkbenchActionBar('sceneEditor.title').items[0].label, 'Source');
	assert.equal(createWorkbenchActionBar('behaviorLens.title').items[0].label, 'Source');
});

test('shared command titles preserve state-dependent actions on every surface', () => {
	for (const short of [false, true]) {
		assert.equal(editorCommandTitle('pause', false, short), 'Pause');
		assert.equal(editorCommandTitle('pause', true, short), 'Resume');
		assert.equal(editorCommandTitle('resources', true, short), 'Hide Files');
		assert.equal(editorCommandTitle('filter', true, short), 'Lua Files Only');
	}
});
