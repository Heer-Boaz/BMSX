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
import { UnavailableScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { ResourceEditorResolver } from '../../ide/workbench/services/editor/resource_editor_resolver';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first', options = { pos = { x = 1, y = 2, z = 3 } } },
 { member_id = 'same', definition_id = 'second', options = { pos = { x = 4, y = 5, z = 6 } } },
} })
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'other', options = { pos = { x = 7, y = 8, z = 9 } } },
} })`;
const INVENTORY = ["local scenes = require('cartlib/world/scene_library')",
	...Array.from({ length: 32 }, (_, index) => `scenes.register('inventory_${index}_${'long_'.repeat(20)}', { objects = {} })`)].join('\n');

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['inventory.lua', INVENTORY],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const main = f.editor.mainWorkspace, parts = f.editor.editorParts;
	const open = (index: number, workingCopy = model) => {
		const document = f.ide.sceneSources.get(workingCopy);
		return f.editor.openSceneInMain(workingCopy, { document, sourceVersion: workingCopy.version, scene: document.scenes[index] }, inputFocus.target!);
	};
	f.first.focus(); assert.equal(await open(0), true); f.update();
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 2), true); primary.hierarchy.update(); primary.details.update();
	main.focusPrimary(); resetNavigationHistoryState();
	return { ...f, model, resource, primary, main, parts, open, origin: primary.hierarchy.control.focusTarget };
}

for (const visible of [false, true]) test(`Main Source reuses floating canonical text without changing Files or its authored subject (Files visible: ${visible})`, async t => {
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
	const selected = f.primary.consumer.selection, subject = f.primary.consumer.subject;
	const disclosure = file.collapsed, scroll = panel.scroll, hscroll = panel.hscroll;
	const groups = [...f.parts.groups], execution = f.host.execution.revision;
	const expected = { row: 0, column: 0 }; f.model.buffer.positionAt(f.primary.consumer.selectionRange.start, expected);
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', f.origin);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	assert.ok(f.secondGroup.model.activeTab === existing && f.secondGroup.panes.activePane === pane);
	assert.ok(inputFocus.admittedTarget !== null && f.secondGroup.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(pane.code.view.cursorRow, expected.row); assert.equal(pane.code.view.cursorColumn, expected.column);
	assert.equal(f.parts.groups.length, groups.length); assert.ok(groups.every((group, index) => f.parts.groups[index] === group));
	assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
	assert.ok(f.main.primary === f.primary && f.primary.consumer.subject === subject && f.primary.consumer.selection === selected);
	assert.ok(panel.files.selectedNode === file); assert.equal(file.collapsed, disclosure);
	assert.equal(panel.scroll, scroll); assert.equal(panel.hscroll, hscroll); assert.equal(panel.visible, visible);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	assert.equal(f.host.execution.revision, execution);
});

test('Main Source to Side retains its exact document neighbor across draft settlement instead of using floating affinity or a newer active group', async t => {
	const f = await fixture(t), origin = f.parts.main.activeGroup;
	const side = f.parts.splitGroup(origin, 'right'); assert.ok(side !== undefined);
	side.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	origin.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const floating = f.secondGroup.model.activeTab;
	assert.equal(f.parts.main.activateGroup(origin), true); f.main.focusPrimary();
	const field = f.primary.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	const release = f.model.onDidChangeContent(() => { release(); assert.equal(f.parts.main.activateGroup(side), true); }); t.after(release);
	const groups = [...f.parts.groups];
	const expected = { row: 0, column: 0 }; f.model.buffer.positionAt(f.primary.consumer.selectionRange.start, expected);
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.sourceToSide', field.field.focusTarget);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	const input = side.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.ok(f.secondGroup.model.activeTab === floating);
	assert.ok(origin.model.activeTab instanceof CodeEditorInput && origin.model.activeTab.workingCopy === f.secondInput.workingCopy);
	assert.ok(inputFocus.admittedTarget !== null && side.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(input.context.view.cursorRow, expected.row); assert.equal(input.context.view.cursorColumn, expected.column);
	assert.equal(field.pending, false); assert.ok(f.model.buffer.getText().includes('x = 123'));
	assert.equal(f.parts.groups.length, groups.length); assert.ok(groups.every((group, index) => f.parts.groups[index] === group));
	const selected = f.primary.consumer.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === f.primary.consumer.subject!.objects[1] && f.main.primary === f.primary);
});

test('Main Source enablement observes its attached capability without producing source or semantic state', async t => {
	const f = await fixture(t), project = getOrCreateSemanticProject(editorTextModelService, f.resource.contextId);
	const location = t.mock.method(f.primary.consumer, 'getSourceLocation');
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
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', field.field.focusTarget);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	assert.equal(field.pending, false); assert.ok(f.model.buffer.getText().includes('x = 123'));
	const selected = f.primary.consumer.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === f.primary.consumer.subject!.objects[1]);
	const input = f.parts.main.activeGroup.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	const expected = { row: 0, column: 0 }; f.model.buffer.positionAt(f.primary.consumer.selectionRange.start, expected);
	assert.equal(input.context.view.cursorRow, expected.row); assert.equal(input.context.view.cursorColumn, expected.column);
	assert.ok(f.main.primary === f.primary && f.primary.consumer.subject === f.primary.consumer.document!.scenes[0]);
});

for (const change of ['selection', 'selected occurrence deletion', 'Main replacement', 'suspension', 'foreign focus'] as const)
	test(`asynchronous Main Source discovery cannot acquire a destination after ${change}`, async t => {
		const f = await fixture(t), ready = Promise.withResolvers<void>();
		const capture = f.primary.consumer.captureSourceLocation.bind(f.primary.consumer);
		t.mock.method(f.primary.consumer, 'captureSourceLocation', () => {
			const lease = capture();
			return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
		});
		const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
		const groups = [...f.parts.groups];
		f.editor.commands.execute('editor.sourceToSide', f.origin);
		assert.equal(request.mock.callCount(), 1); assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.parts.groups.length, groups.length); assert.equal(navigationState.back.length, 0);
		if (change === 'selection') assert.equal(selectSceneOutlineRow(f.primary.view.hierarchy, 1), true);
		else if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.removeSelectedMember(), true);
		else if (change === 'Main replacement') assert.equal(await f.open(1), true);
		else if (change === 'suspension') f.main.suspend();
		else f.second.focus();
		const primary = f.main.primary, focused = inputFocus.admittedTarget;
		ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
		assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.parts.groups.length, groups.length); assert.ok(groups.every((group, index) => f.parts.groups[index] === group));
		assert.ok(f.main.primary === primary && inputFocus.admittedTarget === focused);
		if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.selection, undefined);
	});

test('a newer actual Main Source discovery owns admission without replacing its retained authoring context', async t => {
	const f = await fixture(t), first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>();
	const capture = f.primary.consumer.captureSourceLocation.bind(f.primary.consumer);
	let captures = 0;
	t.mock.method(f.primary.consumer, 'captureSourceLocation', () => {
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
	assert.ok(f.main.primary === f.primary && f.primary.consumer.subject === f.primary.consumer.document!.scenes[0]);
});

test('a newer synchronous Main Source owns intent while its floating affinity receiver is still resolving', async t => {
	const f = await fixture(t), read = Promise.withResolvers<void>(), receiver = Promise.withResolvers<void>();
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const existing = f.secondGroup.model.activeTab; assert.ok(existing instanceof CodeEditorInput && existing.workingCopy === f.model);
	f.main.focusPrimary(); resetNavigationHistoryState();
	const capture = f.primary.consumer.captureSourceLocation.bind(f.primary.consumer);
	let captures = 0;
	t.mock.method(f.primary.consumer, 'captureSourceLocation', () => {
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
	const selected = f.primary.consumer.selection, focused = inputFocus.admittedTarget;
	f.editor.commands.execute('editor.source', f.origin);
	f.editor.commands.execute('editor.source', f.origin);
	assert.equal(captures, 2); assert.equal(receivers, 1); assert.equal(request.mock.callCount(), 2); assert.equal(opening.mock.callCount(), 1);
	assert.ok(inputFocus.admittedTarget === focused && f.primary.consumer.selection === selected);
	read.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
	assert.equal(opening.mock.callCount(), 1); assert.equal(receivers, 1);
	assert.ok(inputFocus.admittedTarget === focused && f.secondGroup.model.activeTab === existing);
	receiver.resolve(); assert.ok(await request.mock.calls[1].result !== undefined);
	assert.ok(f.secondGroup.model.activeTab === existing && f.main.primary === f.primary && f.primary.consumer.selection === selected);
	assert.ok(inputFocus.admittedTarget !== null && f.secondGroup.focusScope.contains(inputFocus.admittedTarget.scope));
});

for (const publication of ['opening', 'model activation', 'attachment'] as const)
	test(`an older floating Source ${publication} cannot cancel newer Main Source discovery with its later focus`, async t => {
		const f = await fixture(t), read = Promise.withResolvers<void>();
		await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
		const existing = f.secondGroup.model.activeTab; assert.ok(existing instanceof CodeEditorInput && existing.workingCopy === f.model);
		f.main.focusPrimary(); resetNavigationHistoryState();
		const selected = f.primary.consumer.selection, capture = f.primary.consumer.captureSourceLocation.bind(f.primary.consumer);
		let captures = 0;
		t.mock.method(f.primary.consumer, 'captureSourceLocation', () => {
			const lease = capture();
			return captures++ === 0 ? lease : { ...lease, readLocation: async () => { await read.promise; return lease.readLocation(); } };
		});
		const request = t.mock.method(f.editor.navigation, 'openSource');
		f.editor.commands.execute('editor.source', f.origin);
		const invoke = () => { release(); f.editor.commands.execute('editor.source', f.origin); };
		const release = publication === 'opening' ? f.secondGroup.panes.onDidBeginOpen(invoke)
			: publication === 'model activation' ? f.secondGroup.model.onDidChange(change => { if (change === 'active') invoke(); })
				: f.secondGroup.panes.onWillShowEditor(invoke);
		t.after(release);
		await request.mock.calls[0].result;
		assert.equal(captures, 2); assert.equal(request.mock.callCount(), 2);
		read.resolve(); assert.ok(await request.mock.calls[1].result !== undefined);
		assert.ok(f.secondGroup.model.activeTab === existing && f.main.primary === f.primary && f.primary.consumer.selection === selected);
		assert.ok(inputFocus.admittedTarget !== null && f.secondGroup.focusScope.contains(inputFocus.admittedTarget.scope));
		assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
		await f.editor.navigation.goBackward();
		const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient);
		const restoredSelection = restored.consumer.selection;
		assert.ok(navigationState.activeOwner === f.main && restored.consumer.subject === restored.consumer.document!.scenes[0]);
		assert.ok(restoredSelection?.kind === 'member' && restoredSelection.entry === restored.consumer.subject.objects[1]);
		assert.ok(inputFocus.admittedTarget !== null && restored.scope.contains(inputFocus.admittedTarget.scope));
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
		assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
		if (change === 'source edit') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer canonical generation\n' }]);
		else if (change === 'source model replacement') {
			f.firstGroup.clear(); f.secondGroup.clear();
			editorTextModelService.clear();
			const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
			assert.ok(model !== f.model);
			const document = f.ide.sceneSources.get(model);
			assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] },
				f.parts.main.activeGroup.focusTarget), true);
		}
		else if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.removeSelectedMember(), true);
		else if (change === 'Main replacement') assert.equal(await f.open(1), true);
		else { f.main.suspend(); f.second.focus(); }
		const primary = f.main.primary, focused = inputFocus.admittedTarget;
		ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined); f.update();
		assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
		assert.ok(f.main.primary === primary && inputFocus.admittedTarget === focused);
		if (change === 'source model replacement') {
			assert.ok(primary instanceof ScenePrimaryClient && primary !== f.primary);
			assert.ok(primary.consumer.workingCopy !== f.model && primary.consumer.workingCopy === editorTextModelService.get(f.resource));
		} else if (change === 'Main replacement') {
			assert.ok(primary instanceof ScenePrimaryClient && primary !== f.primary);
			assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
		} else if (change === 'selected occurrence deletion') {
			assert.equal(f.primary.consumer.selection, undefined);
			assert.equal(f.primary.consumer.subject!.objects.length, 1);
		} else if (change === 'suspension') {
			assert.equal(f.primary.hierarchy.control.hasView, false); assert.equal(f.primary.details.control.hasView, false);
		}
	});

for (const change of ['selection', 'selected occurrence deletion', 'foreign focus'] as const)
	test(`Main Source captures its invoking member before draft publication changes ${change}`, async t => {
		const f = await fixture(t), field = f.primary.details.control.controls[0];
		field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
		let published = false;
		const release = f.model.onDidChangeContent(() => {
			release(); published = true;
			if (change === 'selection') { f.primary.view.refresh(); assert.equal(selectSceneOutlineRow(f.primary.view.hierarchy, 1), true); }
			else if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.removeSelectedMember(), true);
			else f.second.focus();
		}); t.after(release);
		const opening = t.mock.method(f.editor.navigation, 'openResource');
		f.editor.commands.execute('editor.source', field.field.focusTarget);
		assert.equal(published, true); assert.equal(field.pending, false); assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.parts.main.activeGroup.model.tabs.length, 0); assert.ok(f.main.primary === f.primary);
		if (change === 'selection') {
			const selected = f.primary.consumer.selection;
			assert.ok(selected?.kind === 'member' && selected.entry === f.primary.consumer.subject!.objects[0]);
		} else if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.selection, undefined);
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
		else if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.removeSelectedMember(), true);
		else if (change === 'Main replacement') assert.equal(await f.open(1), true);
		else f.main.suspend();
		const primary = f.main.primary, focused = inputFocus.admittedTarget;
		assert.equal(menu.visible, false);
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
		assert.equal(request.mock.callCount(), 0); assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
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
			else assert.equal(f.primary.consumer.removeSelectedMember(), true);
		}); t.after(release);
		const opening = t.mock.method(f.editor.navigation, 'openResource');
		menu.accept();
		assert.equal(published, true); assert.equal(menu.visible, false); assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.parts.main.activeGroup.model.tabs.length, 0); assert.ok(f.main.primary === f.primary);
		if (change === 'selected occurrence deletion') assert.equal(f.primary.consumer.selection, undefined);
		else {
			const selected = f.primary.consumer.selection;
			assert.ok(selected?.kind === 'member' && selected.entry === f.primary.consumer.subject!.objects[0]);
		}
	});

test('unavailable retained Main Source opens only its admitted current canonical file, never its obsolete saved selection', async t => {
	const f = await fixture(t), saved = f.main.serialize();
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.getText().length, text: '-- new canonical file\nreturn {}\n' }]);
	const restore = f.main.beginRestore();
	try {
		assert.equal(await restore.restore(saved, (...args) => f.editor.restorePrimaryClient(...args)), true);
		restore.focusClient(); f.update();
	} finally { restore.dispose(); }
	const unavailable = f.main.primary; assert.ok(unavailable instanceof UnavailableScenePrimaryClient);
	const copies = unavailable.getWorkingCopies(); assert.equal(copies.length, 1); assert.ok(copies[0] === f.model);
	await f.editor.navigation.openResource(f.secondGroup, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const input = f.secondGroup.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	input.context.view.cursorRow = 1; input.context.view.cursorColumn = 3;
	f.main.focusPrimary(); resetNavigationHistoryState();
	const request = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', unavailable.hierarchy.commandTarget);
	assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
	assert.ok(f.secondGroup.model.activeTab === input && f.main.primary === unavailable);
	assert.equal(input.context.view.cursorRow, 1); assert.equal(input.context.view.cursorColumn, 3);
	assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
	assert.ok(navigationState.activeOwner === f.secondGroup);
});
