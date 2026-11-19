import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ResourceEditorResolver } from '../../ide/workbench/services/editor/resource_editor_resolver';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_IMPORTS } from '../fixtures/studio/scene_viewport';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
local prefab = require('cartlib/world/prefab')
prefab.define({def_id='first',class=require('cartlib/world/object_3d')})
prefab.define({def_id='second',class=require('cartlib/world/object_3d')})
prefab.define({def_id='other',class=require('cartlib/world/object_3d')})
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first', position = { x = 1, y = 2, z = 3 } },
 { member_id = 'same', definition_id = 'second', position = { x = 4, y = 5, z = 6 } },
} })
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'other', position = { x = 7, y = 8, z = 9 } },
} })`;
const INVENTORY = ["local scenes = require('cartlib/world/scene_library')",
	...Array.from({ length: 32 }, (_, index) => `scenes.register('inventory_${index}_${'long_'.repeat(20)}', { objects = {} })`)].join('\n');

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SOURCE], ['inventory.lua', INVENTORY],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const main = f.editor.mainWorkspace, parts = f.editor.editorParts;
	const open = (index: number, workingCopy = model) => {
		const document = f.ide.sceneSources.get(workingCopy);
		return f.editor.openSceneInMain(() => ({ model: workingCopy, subject: { document, sourceVersion: workingCopy.version, scene: document.scenes[index] } }), inputFocus.target!);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 2), true); f.update();
	main.focusPrimary(); resetNavigationHistoryState();
	return { ...f, model, resource, primary, main, parts, open, origin: primary.hierarchy.control.focusTarget };
}

test('Main consumes an explicit source request intact without capturing another selection predicate', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy, selected = f.primary.authoring.selection;
	t.mock.method(f.primary, 'captureSourceLocation', () => assert.fail('the supplied request is the actual source authority'));
	let reads = 0;
	const result = await f.editor.navigation.openSource(f.main, { target: f.origin, source: {
		isCurrent: () => true, readLocation: () => { reads++; return { model, modelVersion: model.version }; },
	} });
	assert.ok(result !== undefined); assert.equal(reads, 1);
	assert.equal(f.firstGroup.model.activeTab, f.firstInput); assert.equal(f.main.primary, f.primary);
	assert.equal(f.primary.authoring.selection, selected); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('a revoked explicit Main source request cannot accept its still-focused Details draft', async t => {
	const f = await fixture(t), field = f.primary.details.control.controls[0], version = f.model.version;
	f.main.focusPrimary('details'); assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
	t.mock.method(f.primary, 'captureSourceLocation', () => assert.fail('the supplied request cannot borrow primary selection authority'));
	const groups = [...f.parts.groups]; let reads = 0;
	assert.equal(await f.editor.navigation.openSource(f.main, { target: f.origin, placement: 'side', source: {
		isCurrent: () => false, readLocation: () => { reads++; return { model: f.model, modelVersion: f.model.version }; },
	} }), undefined);
	assert.equal(reads, 0); assert.equal(field.pending, true); assert.equal(inputFocus.target, field.field.focusTarget);
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), SOURCE); assert.deepEqual(f.parts.groups, groups);
});

test('a revoked supplied Main receipt cannot cancel the actual primary selection pending discovery', async t => {
	const f = await fixture(t), ready = Promise.withResolvers<void>(), request = f.primary.captureSourceLocation()!;
	t.mock.method(f.primary, 'captureSourceLocation', () => ({ ...request, readLocation: async () => { await ready.promise; return request.readLocation(); } }));
	const pending = f.editor.navigation.openSource(f.main, { target: f.origin, placement: 'side' });
	assert.equal(await f.editor.navigation.openSource(f.main, { target: f.origin, source: {
		isCurrent: () => false, readLocation: () => assert.fail('revoked Main receipt cannot replace active discovery'),
	} }), undefined);
	ready.resolve(); assert.ok(await pending !== undefined);
	const input = f.parts.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model); assert.equal(f.main.primary, f.primary);
});

for (const visible of [false, true]) test(`Main Source opens beside its stage without changing the floating Source, Files or its authored subject (Files visible: ${visible})`, async t => {
	const f = await fixture(t), panel = f.editor.resourcePanel;
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const existing = f.secondGroup.model.activeTab, pane = f.secondGroup.panes.activePane;
	assert.ok(existing instanceof CodeEditorInput && pane instanceof CodeEditorPane);
	panel.show(); f.update();
	panel.queuePendingSelection({ contextId: f.sources.systemContextId, path: 'inventory.lua' }); panel.applyPendingSelection();
	const file = panel.files.selectedNode; assert.ok(file !== null && file.element.kind === 'file');
	panel.toggleFileDisclosure(file); panel.setScroll(3.5); panel.setHScroll(4);
	assert.ok(panel.scroll > 0 && panel.hscroll > 0);
	if (!visible) panel.hide();
	f.main.focusPrimary();
	const selected = f.primary.authoring.selection, subject = f.primary.authoring.subject;
	const disclosure = file.collapsed, scroll = panel.scroll, hscroll = panel.hscroll;
	const groups = [...f.parts.groups], execution = f.host.execution.revision;
	const expected = { row: 0, column: 0 }; f.model.buffer.positionAt(f.primary.authoring.selectionRange.start, expected);
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', f.origin);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	assert.ok(f.secondGroup.model.activeTab === existing && f.secondGroup.panes.activePane === pane);
	const receiving = f.parts.main.activeGroup;
	const input = receiving.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.ok(inputFocus.admittedTarget !== null && receiving.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(input.context.view.cursorRow, expected.row); assert.equal(input.context.view.cursorColumn, expected.column);
	assert.equal(f.parts.groups.length, groups.length + 1); assert.ok(groups.every(group => f.parts.groups.includes(group)));
	assert.ok(f.parts.main.groups.some(group => group.model.activeTab === f.primary.input));
	assert.ok(f.main.primary === f.primary && f.primary.authoring.subject === subject && f.primary.authoring.selection === selected);
	assert.ok(panel.files.selectedNode === file); assert.equal(file.collapsed, disclosure);
	assert.equal(panel.scroll, scroll); assert.equal(panel.hscroll, hscroll); assert.equal(panel.visible, visible);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	assert.equal(f.host.execution.revision, execution);
});

test('Main Source to Side retains its exact document neighbor across draft settlement instead of using floating affinity or a newer active group', async t => {
	const f = await fixture(t), origin = f.parts.main.activeGroup;
	const side = f.parts.splitGroup(origin, 'right'); assert.ok(side !== undefined);
	side.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const floating = f.secondGroup.model.activeTab;
	assert.equal(f.parts.main.activateGroup(origin), true); f.main.focusPrimary();
	const field = f.primary.details.control.controls[0]; f.main.focusPrimary('details'); assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
	const release = f.model.onDidChangeContent(() => { release(); assert.equal(f.parts.main.activateGroup(side), true); }); t.after(release);
	const groups = [...f.parts.groups];
	const expected = { row: 0, column: 0 }; f.model.buffer.positionAt(f.primary.authoring.selectionRange.start, expected);
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.sourceToSide', field.field.focusTarget);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	const input = side.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.ok(f.secondGroup.model.activeTab === floating);
	assert.ok(origin.model.activeTab === f.primary.input);
	assert.ok(inputFocus.admittedTarget !== null && side.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(input.context.view.cursorRow, expected.row); assert.equal(input.context.view.cursorColumn, expected.column);
	assert.equal(field.pending, false); assert.ok(f.model.buffer.getText().includes('x = 123,'));
	assert.equal(f.parts.groups.length, groups.length); assert.ok(groups.every((group, index) => f.parts.groups[index] === group));
	const selected = f.primary.authoring.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === f.primary.authoring.subject!.objects[1] && f.main.primary === f.primary);
});

test('Main Source enablement observes its attached capability without producing source or semantic state', async t => {
	const f = await fixture(t), project = getOrCreateSemanticProject(editorTextModelService, f.resource.contextId);
	const location = t.mock.method(f.primary.authoring, 'getSourceLocation');
	const document = t.mock.method(f.ide.sceneSources, 'get');
	const synchronize = t.mock.method(project, 'synchronizeSources');
	const snapshot = t.mock.method(project, 'getSnapshot'), file = t.mock.method(project, 'getFileData');
	for (let index = 0; index < 8; index++) {
		assert.equal(f.editor.commands.isEnabled('editor.source', f.origin), true);
		assert.equal(f.editor.commands.isEnabled('editor.sourceToSide', f.origin), true);
	}
	assert.equal(location.mock.callCount(), 0); assert.equal(document.mock.callCount(), 0);
	assert.equal(synchronize.mock.callCount(), 0); assert.equal(snapshot.mock.callCount(), 0); assert.equal(file.mock.callCount(), 0);
	f.main.suspend();
	assert.equal(f.editor.commands.isEnabled('editor.source', f.origin), false);
	assert.equal(location.mock.callCount(), 0); assert.equal(document.mock.callCount(), 0);
});

test('Main Source accepts the invoking member draft before computing its exact updated canonical range', async t => {
	const f = await fixture(t), field = f.primary.details.control.controls[0];
	f.main.focusPrimary('details'); assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', field.field.focusTarget);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	assert.equal(field.pending, false); assert.ok(f.model.buffer.getText().includes('x = 123,'));
	const selected = f.primary.authoring.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === f.primary.authoring.subject!.objects[1]);
	const input = f.parts.main.activeGroup.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	const expected = { row: 0, column: 0 }; f.model.buffer.positionAt(f.primary.authoring.selectionRange.start, expected);
	assert.equal(input.context.view.cursorRow, expected.row); assert.equal(input.context.view.cursorColumn, expected.column);
	assert.ok(f.main.primary === f.primary && f.primary.authoring.subject === f.primary.authoring.document!.scenes[0]);
});

for (const change of ['selection', 'selected occurrence deletion', 'Main replacement', 'suspension', 'foreign focus'] as const)
	test(`asynchronous Main Source discovery cannot acquire a destination after ${change}`, async t => {
		const f = await fixture(t), ready = Promise.withResolvers<void>();
		const capture = f.primary.authoring.captureSourceLocation.bind(f.primary.authoring);
		t.mock.method(f.primary.authoring, 'captureSourceLocation', () => {
			const lease = capture();
			return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
		});
		const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
		const groups = [...f.parts.groups];
		f.editor.commands.execute('editor.sourceToSide', f.origin);
		assert.equal(request.mock.callCount(), 1); assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.parts.groups.length, groups.length); assert.equal(navigationState.back.length, 0);
		if (change === 'selection') assert.equal(selectSceneOutlineRow(f.primary.view.hierarchy, 1), true);
		else if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.removeSelectedMember(), true);
		else if (change === 'Main replacement') assert.equal(await f.open(1), true);
		else if (change === 'suspension') f.main.suspend();
		else f.second.focus();
		const primary = f.main.primary, focused = inputFocus.admittedTarget;
		ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
		assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.parts.groups.length, groups.length); assert.ok(groups.every((group, index) => f.parts.groups[index] === group));
		assert.ok(f.main.primary === primary && inputFocus.admittedTarget === focused);
		if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.selection, undefined);
	});

test('a newer actual Main Source discovery owns admission without replacing its retained authoring context', async t => {
	const f = await fixture(t), first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>();
	const capture = f.primary.authoring.captureSourceLocation.bind(f.primary.authoring);
	let captures = 0;
	t.mock.method(f.primary.authoring, 'captureSourceLocation', () => {
		const lease = capture(), ready = captures++ === 0 ? first : second;
		return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
	});
	const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.sourceToSide', f.origin);
	f.editor.commands.execute('editor.sourceToSide', f.origin);
	assert.equal(request.mock.callCount(), 2); assert.equal(captures, 2);
	first.resolve(); assert.equal(await request.mock.calls[0].result, undefined); assert.equal(opening.mock.callCount(), 0);
	assert.equal(f.parts.main.groups.length, 1);
	second.resolve(); assert.ok(await request.mock.calls[1].result !== undefined); assert.equal(opening.mock.callCount(), 1);
	assert.equal(f.parts.main.groups.length, 2);
	const input = f.parts.main.activeGroup.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.ok(f.main.primary === f.primary && f.primary.authoring.subject === f.primary.authoring.document!.scenes[0]);
});

test('a newer synchronous Main Source owns intent while its floating affinity receiver is still resolving', async t => {
	const f = await fixture(t), read = Promise.withResolvers<void>(), receiver = Promise.withResolvers<void>();
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const existing = f.secondGroup.model.activeTab; assert.ok(existing instanceof CodeEditorInput && existing.workingCopy === f.model);
	f.main.focusPrimary(); resetNavigationHistoryState();
	const capture = f.primary.authoring.captureSourceLocation.bind(f.primary.authoring);
	let captures = 0;
	t.mock.method(f.primary.authoring, 'captureSourceLocation', () => {
		const lease = capture();
		return captures++ === 0 ? { ...lease, readLocation: async () => { await read.promise; return lease.readLocation(); } } : lease;
	});
	const resolve = ResourceEditorResolver.prototype.resolveEditorInput;
	let receivers = 0;
	t.mock.method(ResourceEditorResolver.prototype, 'resolveEditorInput', function (this: ResourceEditorResolver, ...args: Parameters<typeof resolve>) {
		const input = resolve.apply(this, args);
		if (args[0] !== f.resource) return input;
		receivers++; return receiver.promise.then(() => input);
	});
	const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
	const selected = f.primary.authoring.selection, focused = inputFocus.admittedTarget;
	f.editor.commands.execute('editor.source', f.origin);
	f.editor.commands.execute('editor.source', f.origin);
	assert.equal(captures, 2); assert.equal(receivers, 1); assert.equal(request.mock.callCount(), 2); assert.equal(opening.mock.callCount(), 1);
	assert.ok(inputFocus.admittedTarget === focused && f.primary.authoring.selection === selected);
	read.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
	assert.equal(opening.mock.callCount(), 1); assert.equal(receivers, 1);
	assert.ok(inputFocus.admittedTarget === focused && f.secondGroup.model.activeTab === existing);
	receiver.resolve(); assert.ok(await request.mock.calls[1].result !== undefined);
	assert.ok(f.secondGroup.model.activeTab === existing && f.main.primary === f.primary && f.primary.authoring.selection === selected);
	assert.ok(inputFocus.admittedTarget !== null && f.parts.main.activeGroup.focusScope.contains(inputFocus.admittedTarget.scope));
});

for (const publication of ['opening', 'model activation'] as const)
	test(`an older side Source ${publication} cannot cancel newer Main Source discovery with its later focus`, async t => {
		const f = await fixture(t), read = Promise.withResolvers<void>();
		const stage = f.parts.main.activeGroup, side = f.parts.splitGroup(stage, 'right'); assert.ok(side !== undefined);
		await f.editor.navigation.openResource(side, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
		const existing = side.model.activeTab; assert.ok(existing instanceof CodeEditorInput && existing.workingCopy === f.model);
		f.main.focusPrimary(); resetNavigationHistoryState();
		const selected = f.primary.authoring.selection, capture = f.primary.authoring.captureSourceLocation.bind(f.primary.authoring);
		let captures = 0;
		t.mock.method(f.primary.authoring, 'captureSourceLocation', () => {
			const lease = capture();
			return captures++ === 0 ? lease : { ...lease, readLocation: async () => { await read.promise; return lease.readLocation(); } };
		});
		const request = t.mock.method(f.editor.navigation, 'openSource');
		f.editor.commands.execute('editor.source', f.origin);
		const invoke = () => { release(); f.editor.commands.execute('editor.source', f.origin); };
		const release = publication === 'opening' ? side.panes.onDidBeginOpen(invoke)
			: side.model.onDidChange(change => { if (change === 'active') invoke(); });
		t.after(release);
		await request.mock.calls[0].result;
		assert.equal(captures, 2); assert.equal(request.mock.callCount(), 2);
		read.resolve(); assert.ok(await request.mock.calls[1].result !== undefined);
		assert.ok(side.model.activeTab === existing && f.main.primary === f.primary && f.primary.authoring.selection === selected);
		assert.ok(inputFocus.admittedTarget !== null && side.focusScope.contains(inputFocus.admittedTarget.scope));
		assert.ok(stage.model.activeTab === f.primary.input);
		await f.editor.navigation.goBackward();
		const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient);
		const restoredSelection = restored.authoring.selection;
		assert.ok(navigationState.activeOwner === stage && restored.authoring.subject === restored.authoring.document!.scenes[0]);
		assert.ok(restoredSelection?.kind === 'member' && restoredSelection.entry === restored.authoring.subject.objects[1]);
		assert.ok(inputFocus.admittedTarget !== null && restored.viewportTarget.scope.contains(inputFocus.admittedTarget.scope));
	});

for (const change of ['source edit', 'source model replacement', 'selected occurrence deletion', 'Main replacement', 'suspension'] as const)
	test(`Main Source cannot admit a stale location after ${change} during actual text-editor resolution`, async t => {
		const f = await fixture(t), ready = Promise.withResolvers<void>();
		const resolve = ResourceEditorResolver.prototype.resolveEditorInput;
		let admitted = false;
		t.mock.method(ResourceEditorResolver.prototype, 'resolveEditorInput', function (this: ResourceEditorResolver, ...args: Parameters<typeof resolve>) {
			const input = resolve.apply(this, args);
			if (args[0] !== f.resource || admitted) return input;
			admitted = true; return ready.promise.then(() => input);
		});
		const request = t.mock.method(f.editor.navigation, 'openSource');
		f.editor.commands.execute('editor.source', f.origin);
		assert.equal(request.mock.callCount(), 1); assert.equal(admitted, true);
		assert.ok([...f.parts.main.groups].every(group => [...group.model.tabs].every(input => !(input instanceof CodeEditorInput) || input.workingCopy !== f.model)));
		if (change === 'source edit') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer canonical generation\n' }]);
		else if (change === 'source model replacement') {
			f.parts.main.activeGroup.clear(); f.firstGroup.clear(); f.secondGroup.clear();
			editorTextModelService.clear();
			const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
			assert.ok(model !== f.model);
			const document = f.ide.sceneSources.get(model);
			assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.parts.main.activeGroup.focusTarget), true);
		}
		else if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.removeSelectedMember(), true);
		else if (change === 'Main replacement') assert.equal(await f.open(1), true);
		else { f.main.suspend(); f.second.focus(); }
		const primary = f.main.primary, focused = inputFocus.admittedTarget;
		ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined); f.update();
		assert.ok([...f.parts.main.groups].every(group => [...group.model.tabs].every(input => !(input instanceof CodeEditorInput) || input.workingCopy !== f.model)));
		assert.ok(f.main.primary === primary && inputFocus.admittedTarget === focused);
		if (change === 'source model replacement') {
			assert.ok(primary instanceof ScenePrimaryClient && primary !== f.primary);
			assert.ok(primary.authoring.workingCopy !== f.model && primary.authoring.workingCopy === editorTextModelService.get(f.resource));
		} else if (change === 'Main replacement') {
			assert.ok(primary instanceof ScenePrimaryClient && primary !== f.primary);
			assert.ok(primary.authoring.subject === primary.authoring.document!.scenes[1]);
		} else if (change === 'selected occurrence deletion') {
			assert.equal(f.primary.authoring.selection, undefined);
			assert.equal(f.primary.authoring.subject!.objects.length, 1);
		} else if (change === 'suspension') {
			assert.equal(f.primary.hierarchy.control.hasView, false); assert.equal(f.primary.details.control.hasView, false);
		}
	});

for (const change of ['selection', 'selected occurrence deletion', 'foreign focus'] as const)
	test(`Main Source captures its invoking member before draft publication changes ${change}`, async t => {
		const f = await fixture(t), field = f.primary.details.control.controls[0];
		f.main.focusPrimary('details'); assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
		let published = false;
		const release = f.model.onDidChangeContent(() => {
			release(); published = true;
			if (change === 'selection') { f.primary.view.refresh(); assert.equal(selectSceneOutlineRow(f.primary.view.hierarchy, 1), true); }
			else if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.removeSelectedMember(), true);
			else f.second.focus();
		}); t.after(release);
		const opening = t.mock.method(f.editor.navigation, 'openResource');
		f.editor.commands.execute('editor.source', field.field.focusTarget);
		assert.equal(published, true); assert.equal(field.pending, false); assert.equal(opening.mock.callCount(), 0);
		assert.ok([...f.parts.main.groups].every(group => [...group.model.tabs].every(input => !(input instanceof CodeEditorInput) || input.workingCopy !== f.model))); assert.ok(f.main.primary === f.primary);
		if (change === 'selection') {
			const selected = f.primary.authoring.selection;
			assert.ok(selected?.kind === 'member' && selected.entry === f.primary.authoring.subject!.objects[0]);
		} else if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.selection, undefined);
		else assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	});

for (const change of ['selection', 'selected occurrence deletion', 'Main replacement', 'suspension'] as const)
	test(`an armed Main Source popup cannot acquire a new subject after ${change}`, async t => {
		const f = await fixture(t), menu = f.editor.contextMenu;
		f.editor.commands.execute('contextMenu', f.origin); assert.equal(menu.visible, true);
		menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === 'editor.source');
		assert.ok(menu.model.selectedIndex >= 0 && menu.model.rows[menu.model.selectedIndex].enabled);
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
		const request = t.mock.method(f.editor.navigation, 'openSource');
		if (change === 'selection') assert.equal(selectSceneOutlineRow(f.primary.view.hierarchy, 1), true);
		else if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.removeSelectedMember(), true);
		else if (change === 'Main replacement') assert.equal(await f.open(1), true);
		else f.main.suspend();
		const primary = f.main.primary, focused = inputFocus.admittedTarget;
		assert.equal(menu.visible, false);
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
		assert.equal(request.mock.callCount(), 0); assert.ok([...f.parts.main.groups].every(group => [...group.model.tabs].every(input => !(input instanceof CodeEditorInput) || input.workingCopy !== f.model)));
		assert.ok(f.main.primary === primary && inputFocus.admittedTarget === focused);
	});

for (const change of ['selection', 'selected occurrence deletion'] as const)
	test(`Main popup Source cannot retarget after its return-focus callback changes ${change}`, async t => {
		const f = await fixture(t), menu = f.editor.contextMenu;
		f.editor.commands.execute('contextMenu', f.origin); assert.equal(menu.visible, true);
		menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === 'editor.source');
		assert.ok(menu.model.selectedIndex >= 0 && menu.model.rows[menu.model.selectedIndex].enabled);
		let published = false;
		const release = f.primary.hierarchy.control.focusTarget.onDidFocus(() => {
			release(); published = true;
			if (change === 'selection') assert.equal(selectSceneOutlineRow(f.primary.view.hierarchy, 1), true);
			else assert.equal(f.primary.authoring.removeSelectedMember(), true);
		}); t.after(release);
		const opening = t.mock.method(f.editor.navigation, 'openResource');
		menu.accept();
		assert.equal(published, true); assert.equal(menu.visible, false); assert.equal(opening.mock.callCount(), 0);
		assert.ok([...f.parts.main.groups].every(group => [...group.model.tabs].every(input => !(input instanceof CodeEditorInput) || input.workingCopy !== f.model))); assert.ok(f.main.primary === f.primary);
		if (change === 'selected occurrence deletion') assert.equal(f.primary.authoring.selection, undefined);
		else {
			const selected = f.primary.authoring.selection;
			assert.ok(selected?.kind === 'member' && selected.entry === f.primary.authoring.subject!.objects[0]);
		}
	});

test('a Scene whose occurrence was removed opens only its current canonical source', async t => {
	const f = await fixture(t);
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.getText().length, text: '-- new canonical file\nreturn {}\n' }]);
	f.update();
	assert.equal(f.primary.authoring.availability, 'unavailable');
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const input = f.secondGroup.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	input.context.view.cursorRow = 1; input.context.view.cursorColumn = 3;
	f.main.focusPrimary(); resetNavigationHistoryState();
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', f.primary.hierarchy.commandTarget);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	assert.ok(f.secondGroup.model.activeTab === input && f.main.primary === f.primary);
	assert.equal(input.context.view.cursorRow, 1); assert.equal(input.context.view.cursorColumn, 3);
	const sourceGroup = f.parts.main.activeGroup, source = sourceGroup.model.activeTab;
	assert.ok(source instanceof CodeEditorInput && source.workingCopy === f.model);
	assert.ok(navigationState.activeOwner === sourceGroup);
});

for (const floating of [false, true]) for (const command of ['editor.source', 'editor.sourceToSide'] as const)
	test(`Main ${command} retains its Scene-owned neighbor when the existing Source group is active (floating: ${floating})`, async t => {
		const f = await fixture(t), sceneGroup = f.parts.findGroup(f.primary.input)!;
		const sourceGroup = f.parts.sideGroup(sceneGroup); assert.ok(sourceGroup !== undefined);
		await f.editor.navigation.openResource(sourceGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
		const source = sourceGroup.model.activeTab; assert.ok(source instanceof CodeEditorInput);
		if (floating) {
			assert.equal(f.main.setRegionPlacement('hierarchy', 'floatingWindow'), true); f.update();
		}
		const origin = floating ? f.main.regions.hierarchy.window.actionFocusTarget : f.primary.hierarchy.control.focusTarget;
		assert.equal(origin.focus(), true);
		assert.ok(f.parts.activeGroup === sourceGroup, 'companion focus does not change the last active document group');
		const groups = [...f.parts.groups], inputs = groups.map(group => [...group.model.tabs]);
		const selected = f.primary.authoring.selection;
		const request = t.mock.method(f.editor.navigation, 'openSource');
		f.editor.commands.execute(command, origin);
		assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
		assert.ok(f.parts.activeGroup === sourceGroup && sourceGroup.model.activeTab === source);
		assert.ok(sceneGroup.panes.activePane?.input === f.primary.input, 'Source keeps the owning Scene viewport visible');
		assert.equal(f.parts.groups.length, groups.length);
		assert.ok(groups.every((group, index) => f.parts.groups[index] === group && group.model.tabs.length === inputs[index].length
			&& group.model.tabs.every((input, position) => input === inputs[index][position])));
		assert.ok(f.main.primary === f.primary && f.primary.authoring.selection === selected);
	});
