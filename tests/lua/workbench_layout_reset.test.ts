import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
scenes.register('room',{objects={{member_id='unit',definition_id='actor',spatial={local_transform={1,0,0,0,1,0,0,0,1,1,2,3}}}}})
return {}`;

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny'); f.first.focus();
	const main = f.editor.mainWorkspace;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.update();
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	return { ...f, main, primary, model };
}

for (const invocation of ['owner', 'command'] as const) for (const draft of ['34', '(']) test(`${invocation} layout reset keeps the retained Main subject and its ${draft === '34' ? 'valid' : 'invalid'} focused draft`, async t => {
	const f = await fixture(t), { main, primary, model } = f;
	main.setRegionPlacement('hierarchy', 'floatingWindow'); main.setRegionPlacement('details', 'floatingWindow');
	main.regionLayout.hierarchyWidth = 333; main.regionLayout.detailsWidth = 444;
	const field = primary.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, draft, true);
	const target = inputFocus.admittedTarget, generation = primary.details.scope.contextGeneration, selection = primary.consumer.selection;
	const groups = [...f.editor.editorParts.groups], tabs = groups.map(group => [...group.model.tabs]);
	const attach = t.mock.method(primary.details.control, 'setView'), detach = t.mock.method(primary.details.control, 'clearView');
	if (invocation === 'owner') assert.equal(f.editor.resetLayout(), true);
	else {
		assert.equal(f.editor.commands.isEnabled('workspace.resetLayout', target), true);
		f.editor.commands.execute('workspace.resetLayout', target);
	}
	f.update();
	assert.ok(main.primary === primary && primary.consumer.selection === selection);
	assert.ok(inputFocus.admittedTarget === target && primary.details.control.controls[0] === field);
	assert.equal(primary.details.scope.contextGeneration, generation);
	assert.equal(field.pending, true); assert.equal(field.field.text, draft);
	assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.canUndo, false);
	for (const region of ['hierarchy', 'details'] as const) {
		assert.equal(main.regions[region].placement, 'dockedMain'); assert.equal(main.regions[region].displayed, true);
		assert.equal(primary[region].layoutState.headerVisible, true);
	}
	assert.equal(main.regionLayout.hierarchyWidth, undefined); assert.equal(main.regionLayout.detailsWidth, undefined);
	assert.ok(f.editor.editorParts.groups.length === groups.length && groups.every((group, index) => f.editor.editorParts.groups.includes(group)
		&& group.model.tabs.length === tabs[index].length && group.model.tabs.every((input, tab) => input === tabs[index][tab])));
	assert.equal(attach.mock.callCount(), 0); assert.equal(detach.mock.callCount(), 0);
	field.cancel();
});

test('a reset before asynchronous Main recovery preserves the newer layout without discarding the recovered subject', async t => {
	const f = await fixture(t), { main } = f;
	main.setRegionPlacement('details', 'floatingWindow'); main.regionLayout.detailsWidth = 444;
	const snapshot = main.serialize(), request = main.beginRestore();
	try {
		assert.equal(main.resetLayout(), true);
		assert.equal(await request.restore(snapshot, (...args) => f.editor.restorePrimaryClient(...args)), true);
		f.update();
		assert.ok(main.primary instanceof ScenePrimaryClient);
		assert.equal(main.regions.details.placement, 'dockedMain');
		assert.equal(main.regionLayout.detailsWidth, undefined);
		assert.equal(main.regionLayout.detailsVisible, true);
	} finally { request.dispose(); }
});

test('layout reset retains the selected activity and its open intent independently of floating minimization', async t => {
	const f = await fixture(t), { main } = f;
	assert.equal(main.openActivity('problems'), true);
	const activity = main.activity, selected = main.activities.selectedId;
	assert.equal(main.setActivityPlacement('floatingWindow'), true); main.minimizeActivity();
	main.regionLayout.activityHeight = 177;
	assert.equal(main.resetLayout(), true); f.update();
	assert.ok(main.activity === activity); assert.equal(main.activities.selectedId, selected);
	assert.equal(main.activityPlacement, 'dockedMain'); assert.equal(main.activityDisplayed, true);
	assert.equal(main.regionLayout.activityHeight, undefined); assert.equal(main.activityWindow.model.minimized, false);
	assert.equal(main.setActivityVisible(false), true);
	assert.equal(main.resetLayout(), true); f.update();
	assert.ok(main.activity === activity); assert.equal(main.activities.selectedId, selected);
	assert.equal(main.regionLayout.activityVisible, false); assert.equal(main.activityDisplayed, false);
});

for (const region of ['hierarchy', 'details'] as const) test(`reset from floating ${region} chrome returns focus to its retained docked region`, async t => {
	const f = await fixture(t), { main, primary } = f;
	main.setRegionPlacement(region, 'floatingWindow');
	const part = main.regions[region], generation = primary[region].scope.contextGeneration;
	assert.equal(part.window.focusTarget.focus(), true);
	assert.equal(main.resetLayout(), true); f.update();
	assert.equal(part.window.surface, undefined); assert.equal(primary[region].attached, true);
	assert.ok(inputFocus.admittedTarget !== null && primary[region].scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(primary[region].scope.contextGeneration, generation); assert.ok(main.primary === primary);
});

test('reset of minimized Main regions reveals their retained controls without selecting another subject', async t => {
	const f = await fixture(t), { main, primary } = f, selection = primary.consumer.selection;
	for (const region of ['hierarchy', 'details'] as const) {
		main.setRegionPlacement(region, 'floatingWindow'); main.minimizeRegion(region);
		assert.equal(primary[region].attached, false);
	}
	assert.equal(main.resetLayout(), true); f.update();
	for (const region of ['hierarchy', 'details'] as const) {
		assert.equal(main.regions[region].placement, 'dockedMain'); assert.equal(primary[region].attached, true);
	}
	assert.ok(main.primary === primary && primary.consumer.selection === selection);
});

test('reset from floating activity chrome focuses the same retained activity after docking', async t => {
	const f = await fixture(t), { main } = f;
	main.openActivity('problems'); const activity = main.activity!;
	main.setActivityPlacement('floatingWindow');
	assert.equal(main.activityWindow.focusTarget.focus(), true);
	assert.equal(main.resetLayout(), true); f.update();
	assert.equal(main.activityWindow.surface, undefined); assert.ok(main.activity === activity && main.activityDisplayed);
	assert.ok(inputFocus.admittedTarget !== null && main.activities.scope.contains(inputFocus.admittedTarget.scope));
});

test('a newer Main allocation published during reset is not replaced by the earlier default request', async t => {
	const f = await fixture(t), { main } = f;
	main.setRegionPlacement('hierarchy', 'floatingWindow');
	const unbind = main.onDidChange(() => { unbind(); main.regionLayout.detailsWidth = 777; }); t.after(unbind);
	assert.equal(main.resetLayout(), true);
	assert.equal(main.regionLayout.detailsWidth, 777, 'the requested allocation belongs to the newer publisher, not a rendered pixel assertion');
});

test('a document opened by Main publication supersedes the earlier reset target set', async t => {
	const f = await fixture(t), { main } = f;
	main.setRegionPlacement('hierarchy', 'floatingWindow');
	const requestedBounds = { left: 20, top: 30, right: 300, bottom: 200 };
	let opened: ReturnType<typeof f.editor.editorParts.createDocument> | undefined;
	const unbind = main.onDidChange(() => { unbind(); opened = f.editor.editorParts.createDocument({ requestedBounds, placement: 'maximized' }); });
	t.after(unbind);
	assert.equal(f.editor.resetLayout(), false);
	assert.ok(opened !== undefined && f.editor.editorParts.documents.includes(opened));
	assert.equal(opened.window!.model.placement, 'maximized');
	assert.deepEqual(opened.window!.model.requestedBounds, requestedBounds, 'new window placement is the exact admitted request, not incidental geometry');
});

test('a newer Files allocation published while cancelling keyboard sizing survives the older reset', t => {
	const f = createActualSourcePanes(t), files = f.editor.resourcePanel;
	f.editor.setFontVariant('tiny'); files.show(); f.editor.update(0);
	assert.equal(files.sash.focusForResize(files.focusTarget), true);
	const release = inputFocus.onDidChangeTarget(() => {
		if (inputFocus.admittedTarget !== files.focusTarget) return;
		release(); files.split.ratio = 0.42;
	}); t.after(release);
	assert.equal(f.editor.resetLayout(), false);
	assert.equal(files.split.ratio, 0.42);
	assert.ok(inputFocus.admittedTarget === files.focusTarget);
});

test('newer placement of a later Main region supersedes the earlier captured reset', async t => {
	const f = await fixture(t), { main } = f;
	main.setRegionPlacement('hierarchy', 'floatingWindow'); main.setRegionPlacement('details', 'floatingWindow');
	const details = main.regions.details.window.model;
	const chosen = { left: 50, top: 60, right: 450, bottom: 360 };
	const unbind = main.regions.hierarchy.window.model.onDidChangePlacement(() => { unbind(); details.setRequestedBounds(chosen, 'maximized'); });
	t.after(unbind);
	assert.equal(main.resetLayout(), false);
	assert.equal(main.regions.details.placement, 'floatingWindow'); assert.equal(details.placement, 'maximized');
	assert.deepEqual(details.requestedBounds, chosen);
});

for (const origin of ['body', 'chrome'] as const) test(`reset ${origin === 'body' ? 'retains' : 'retires'} an asynchronous Source request from ${origin}`, async t => {
	const f = await fixture(t), { main, primary } = f;
	main.setRegionPlacement('details', 'floatingWindow'); main.focusPrimary('details');
	const target = origin === 'body' ? primary.details.commandTarget : main.regions.details.window.focusTarget;
	assert.equal(target.focus(), true);
	const ready = Promise.withResolvers<void>(), capture = primary.consumer.captureSourceLocation.bind(primary.consumer);
	t.mock.method(primary.consumer, 'captureSourceLocation', () => {
		const lease = capture();
		return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
	});
	const opening = t.mock.method(f.editor.navigation, 'openResource');
	const captured = t.mock.method(main, 'captureSourceNavigation');
	const pending = f.editor.navigation.openSource(main, { target });
	assert.equal(opening.mock.callCount(), 0);
	const focusRevision = inputFocus.revision, context = target.scope.contextGeneration;
	const lease = captured.mock.calls[0].result;
	assert.equal(main.resetLayout(), true);
	assert.equal(lease!.isCurrent(), origin === 'body');
	if (origin === 'body') {
		assert.ok(inputFocus.admittedTarget === target); assert.equal(inputFocus.revision, focusRevision);
		assert.equal(target.scope.contextGeneration, context);
	}
	ready.resolve(); const result = await pending;
	if (origin === 'body') {
		assert.ok(result !== undefined); assert.equal(opening.mock.callCount(), 1);
		const input = f.editor.editorParts.activeGroup.model.activeTab;
		assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	} else {
		assert.equal(result, undefined); assert.equal(opening.mock.callCount(), 0);
	}
	assert.ok(main.primary === primary); assert.equal(f.model.buffer.getText(), SOURCE);
});
