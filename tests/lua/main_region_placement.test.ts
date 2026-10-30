import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { findWorkbenchWindowSurface } from '../../ide/workbench/ui/window/control';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
scenes.register('room',{objects={{member_id='unit',definition_id='actor',options={pos={x=1,y=2,z=3}}}}})
return {}`;

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny');
	const main = f.editor.mainWorkspace;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus();
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.update();
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	return { ...f, main, primary, model };
}

for (const region of ['hierarchy', 'details'] as const)
	test(`Main ${region} placement retains the exact native content and semantic subject`, async t => {
		const f = await fixture(t), view = f.primary[region], part = f.main.regions[region];
		f.main.focusPrimary(region);
		const target = inputFocus.admittedTarget!, generation = view.scope.contextGeneration;
		const selection = f.primary.consumer.selection, documents = [...f.editor.editorParts.documents];
		const attach = t.mock.method(view.control, 'setView'), detach = t.mock.method(view.control, 'clearView');
		for (let cycle = 0; cycle < 3; cycle++) {
			assert.equal(f.main.setRegionPlacement(region, 'floatingWindow'), true); f.update();
			assert.equal(part.displayed, true); assert.equal(view.attached, true);
			assert.equal(view.layoutState.headerVisible, false, 'the floating chrome replaces the embedded header');
			assert.ok(view.surface.presentationParent === part.surface && part.surface.presentationParent === part.window.clientSurface);
			assert.ok(findWorkbenchWindowSurface(target, f.editor.surfaces) === part.window.surface);
			assert.ok(inputFocus.admittedTarget === target); assert.equal(view.scope.contextGeneration, generation);
			assert.equal(f.main.setRegionPlacement(region, 'dockedMain'), true); f.update();
			assert.equal(view.layoutState.headerVisible, true);
			assert.ok(part.window.surface === undefined); assert.equal(part.surface.retired, false);
			assert.ok(inputFocus.admittedTarget === target); assert.equal(view.scope.contextGeneration, generation);
		}
		assert.equal(attach.mock.callCount(), 0); assert.equal(detach.mock.callCount(), 0);
		assert.ok(f.main.primary === f.primary && f.primary.consumer.selection === selection);
		const consumers = [...f.main.workingCopyConsumers()]; assert.ok(consumers.length === 1 && consumers[0] === f.primary.consumer);
		assert.ok(f.editor.editorParts.documents.length === documents.length && documents.every((input, index) => f.editor.editorParts.documents[index] === input));
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	});

for (const draft of ['31', '('])
	test(`pure Details relocation preserves its ${draft === '31' ? 'valid' : 'invalid'} concrete field draft`, async t => {
		const f = await fixture(t), panel = f.primary.details, control = panel.control.controls[0];
		assert.equal(control.field.focusTarget.focus(), true); setFieldText(control.field, draft, true);
		const field = control.field.focusTarget, selection = f.primary.consumer.selection, generation = panel.scope.contextGeneration;
		for (const placement of ['floatingWindow', 'dockedMain'] as const) {
			assert.equal(f.main.setRegionPlacement('details', placement), true); f.update();
			assert.ok(inputFocus.admittedTarget === field); assert.equal(control.pending, true); assert.equal(control.field.text, draft);
			assert.equal(panel.scope.contextGeneration, generation); assert.ok(f.primary.consumer.selection === selection);
			assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
		}
		if (draft === '31') {
			f.key('Enter'); assert.equal(f.model.buffer.getText(), SOURCE.replace('x=1,', 'x=31,'));
			assert.equal(control.pending, false); f.model.undo(); assert.equal(f.model.buffer.getText(), SOURCE);
		} else {
			assert.equal(control.commit(), false); assert.equal(f.model.buffer.getText(), SOURCE);
			control.cancel(); assert.equal(control.pending, false);
		}
	});

for (const region of ['hierarchy', 'details'] as const)
	test(`Main ${region} minimize/reveal/close affects its own shell without changing document membership`, async t => {
		const f = await fixture(t), view = f.primary[region], part = f.main.regions[region];
		const documents = [...f.editor.editorParts.documents];
		assert.equal(f.main.setRegionPlacement(region, 'floatingWindow'), true); f.main.focusPrimary(region);
		assert.equal(f.main.minimizeRegion(region), true); f.update();
		assert.equal(part.window.isOpen, true); assert.equal(part.window.model.minimized, true); assert.equal(part.displayed, false);
		f.main.focusPrimary(region); f.update();
		assert.equal(part.window.model.minimized, false); assert.equal(part.displayed, true);
		assert.ok(inputFocus.admittedTarget !== null && view.scope.contains(inputFocus.admittedTarget.scope));
		f.editor.commands.execute('window.hide', part.window.focusTarget); f.update();
		assert.equal(part.window.isOpen, false); assert.equal(f.main.regionLayout[`${region}Visible`], false);
		f.main.focusPrimary(region); f.update();
		assert.equal(part.placement, 'floatingWindow'); assert.equal(part.displayed, true);
		assert.ok(f.editor.editorParts.documents.length === documents.length && documents.every((input, index) => f.editor.editorParts.documents[index] === input));
		assert.ok(f.main.primary === f.primary);
		assert.equal(f.model.buffer.getText(), SOURCE);
	});

for (const region of ['hierarchy', 'details'] as const)
	test(`Main ${region} recovery retains its physical placement and a minimized shell without opening it`, async t => {
		const f = await fixture(t), part = f.main.regions[region];
		f.main.setRegionPlacement(region, 'floatingWindow');
		part.window.setPlacement('right'); f.main.focusPrimary(region); f.main.minimizeRegion(region);
		const snapshot = f.main.serialize(), requested = { ...part.window.model.requestedBounds };
		f.main.setRegionPlacement(region, 'dockedMain');
		const restore = f.main.beginRestore();
		try {
			assert.equal(await restore.restore(snapshot, (...args) => f.editor.restorePrimaryClient(...args)), true);
			restore.focusClient(); f.update();
			assert.equal(part.placement, 'floatingWindow'); assert.equal(part.window.model.placement, 'right');
			assert.equal(part.window.model.minimized, true); assert.equal(part.window.isOpen, true); assert.equal(part.displayed, false);
			// Requested placement is the persisted data contract, not an incidental rendered rectangle.
			assert.deepEqual(part.window.model.requestedBounds, requested);
			const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient && primary !== f.primary);
			assert.ok(primary.consumer.workingCopy === f.model); assert.equal(f.model.buffer.getText(), SOURCE);
			f.main.focusPrimary(region); f.update(); assert.equal(part.displayed, true);
			assert.ok(part.client === primary[region]);
		} finally { restore.dispose(); }
	});

test('a newer region placement and document focus supersede an awaited primary recovery', async t => {
	const f = await fixture(t), part = f.main.regions.details;
	f.main.setRegionPlacement('details', 'floatingWindow');
	const snapshot = f.main.serialize(), ready = Promise.withResolvers<void>(), restore = f.main.beginRestore();
	const restoring = restore.restore(snapshot, async (...args) => { await ready.promise; return f.editor.restorePrimaryClient(...args); });
	assert.equal(f.main.setRegionPlacement('details', 'dockedMain'), true); f.second.focus();
	const focused = inputFocus.admittedTarget;
	ready.resolve();
	try {
		assert.equal(await restoring, true); restore.focusClient(); f.update();
		assert.equal(part.placement, 'dockedMain'); assert.equal(part.window.isOpen, false);
		assert.ok(inputFocus.admittedTarget === focused);
	} finally { restore.dispose(); }
});

test('a primary-local close decision blocks both floating region families and cancellation retains their subjects', async t => {
	const f = await fixture(t);
	for (const region of ['hierarchy', 'details'] as const) f.main.setRegionPlacement(region, 'floatingWindow');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]); f.update();
	f.main.focusPrimary('details');
	const closing = f.main.clearPrimary(f.editor.editorParts.closeController, inputFocus.target);
	for (const region of ['hierarchy', 'details'] as const) {
		const window = f.main.regions[region].window;
		assert.equal(f.editor.surfaces.isFocusAdmitted(window.surface!), false);
		assert.equal(window.focusTarget.focus(), false);
	}
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(f.main.primary === f.primary);
	for (const region of ['hierarchy', 'details'] as const) assert.equal(f.main.regions[region].displayed, true);
	assert.equal(f.model.buffer.getText(), '-- dirty\n' + SOURCE);
});

test('floating region chrome retains the current primary semantic Source and member commands, independently of document focus', async t => {
	const f = await fixture(t), part = f.main.regions.details;
	f.main.setRegionPlacement('details', 'floatingWindow');
	assert.equal(f.editor.commands.isEnabled('sceneEditor.removeMember', part.window.focusTarget), true);
	assert.equal(f.editor.commands.isEnabled('editor.source', part.window.focusTarget), true);
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', part.window.focusTarget);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result; f.update();
	const source = f.editor.editorParts.main.activeGroup.model.activeTab;
	assert.ok(source?.kind === 'code_editor' && source.workingCopy === f.model);
	assert.ok(f.main.primary === f.primary && part.client === f.primary.details);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});
