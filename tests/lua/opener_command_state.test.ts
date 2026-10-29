import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { BehaviorLensEditorPane } from '../../ide/workbench/contrib/behavior_lens/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { ScenarioLabEditorPane } from '../../ide/workbench/contrib/scenario_lab/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { TOP_BAR_MENU_ENTRIES } from '../../ide/workbench/ui/top_bar/menu';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

const EFFECT_SOURCE = `local effects = require('cartlib/actioneffects')
effects.register_effect('effect.one', { cooldown_ms = 10 })
return {}
`;
type Opener = 'behaviorLens' | 'scenarioLab';

async function fixture(t: TestContext, command: Opener) {
	const f = createActualSourcePanes(t, false, [
		['effects.lua', EFFECT_SOURCE], ['cartlib/actioneffects.lua', 'return {}'],
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	if (command === 'behaviorLens') {
		const registration = f.editor.behaviorLens.documents.registrations.getRegistrations(f.sources.systemContextId)
			.find(registration => registration.resource.path === 'effects.lua')!;
		assert.ok(f.editor.behaviorLens.openDefinition(f.firstGroup, registration, { pinned: true }) !== undefined);
	} else f.editor.scenarioLab.open(f.firstGroup);
	f.update();
	const pane = f.firstGroup.panes.activePane;
	assert.ok(command === 'behaviorLens' ? pane instanceof BehaviorLensEditorPane : pane instanceof ScenarioLabEditorPane);
	pane!.focus();
	assert.ok(f.editor.editorParts.activeGroup === f.firstGroup);
	return { ...f, primary, pane: pane!, input: f.firstGroup.model.activeTab! };
}

for (const command of ['behaviorLens', 'scenarioLab'] as const) {
	for (const origin of ['pane', 'Main', 'foreign Source', 'document chrome', 'no target'] as const)
		test(`${command} opener has no borrowed checked state at ${origin}`, async t => {
			const f = await fixture(t, command);
			const target = origin === 'pane' ? f.pane.commandTarget : origin === 'Main' ? f.primary.commandTarget
				: origin === 'foreign Source' ? f.second.commandTarget : origin === 'document chrome' ? f.firstGroup.tabStrip.focusTarget : null;
			assert.equal(target?.resolveCommand(command), undefined);
			assert.equal(f.editor.commands.isEnabled(command, target), true);
			assert.equal(f.editor.commands.isActive(command, target), false,
				'an open action is not a visibility toggle for a retained document kind');
			assert.ok(f.firstGroup.model.activeTab === f.input && f.editor.mainWorkspace.primary === f.primary);
		});

	test(`${command} opener retains an existing view instead of toggling it closed`, async t => {
		const f = await fixture(t, command);
		f.editor.commands.execute(command, f.pane.commandTarget); f.update();
		assert.ok(f.firstGroup.model.activeTab === f.input && f.editor.mainWorkspace.primary === f.primary);
		if (command === 'behaviorLens') {
			assert.equal(f.firstPart.quickInput.visible, true, 'opening Behavior Lens requests a source definition');
			f.key('Escape'); assert.equal(f.firstPart.quickInput.visible, false);
		} else assert.ok(f.firstGroup.panes.activePane === f.pane);
	});

	test(`${command} checked state belongs to its registered native implementation`, async t => {
		const f = await fixture(t, command), target = f.pane.commandTarget;
		let checked = true;
		target.registerCommand(command, { isEnabled: () => true, isChecked: () => checked,
			run: () => assert.fail('checked-state observation cannot execute an opener') });
		assert.equal(f.editor.commands.isActive(command, target), true);
		checked = false; assert.equal(f.editor.commands.isActive(command, target), false);
		target.unregisterCommand(command);
		assert.equal(f.editor.commands.isActive(command, target), false,
			'removing a capability cannot revive checked state from its document kind');
	});
}

test('the actual Tools menu does not mark the Scenario Lab opener as a visibility toggle', async t => {
	const f = await fixture(t, 'scenarioLab');
	f.key('F10');
	for (let index = TOP_BAR_MENU_ENTRIES.findIndex(entry => entry.id === 'tools'); index > 0; index--) f.key('ArrowRight');
	const row = f.editor.contextMenu.model.rows.find(row => row.command === 'scenarioLab')!;
	assert.equal(row.enabled, true); assert.equal(row.active, false);
	f.key('Escape');
	assert.ok(f.firstGroup.model.activeTab === f.input && f.firstGroup.panes.activePane === f.pane);
});
