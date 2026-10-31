import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { UnavailableScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3 } }, options = { strength = 5 } },
 { member_id = 'same', definition_id = 'second', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 5, 6 } }, options = { strength = 8 } },
} })
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'other', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 7, 8, 9 } } },
} })
return {}
`;

async function fixture(t: TestContext, bind = true) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny'); f.first.focus();
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const main = f.editor.mainWorkspace, parts = f.editor.editorParts;
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target!);
	};
	if (bind) { assert.equal(await open(0), true); f.update(); }
	return { ...f, main, parts, model, resource, open };
}

for (const region of ['hierarchy', 'details'] as const)
	test(`pending Main Source loses only its retired invoking ${region} attachment, not its retained primary context`, async t => {
		const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 2), true); f.update();
		primary[region].focus();
		assert.ok(inputFocus.admittedTarget !== null && primary[region].scope.contains(inputFocus.admittedTarget.scope));
		const origin = inputFocus.admittedTarget!;
		const selected = primary.consumer.selection, ready = Promise.withResolvers<void>();
		const capture = primary.consumer.captureSourceLocation.bind(primary.consumer);
		t.mock.method(primary.consumer, 'captureSourceLocation', () => {
			const lease = capture();
			return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
		});
		const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
		f.editor.commands.execute('editor.source', origin);
		assert.equal(request.mock.callCount(), 1); assert.equal(opening.mock.callCount(), 0);
		const sibling = region === 'hierarchy' ? primary.details : primary.hierarchy;
		const commonGeneration = primary.scope.contextGeneration, siblingGeneration = sibling.scope.contextGeneration;
		f.main.setRegionVisible(region, false); f.update();
		const focused = inputFocus.admittedTarget;
		assert.equal(primary.scope.contextGeneration, commonGeneration); assert.equal(sibling.scope.contextGeneration, siblingGeneration);
		assert.ok(f.main.primary === primary && primary.consumer.selection === selected && sibling.control.hasView);
		ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
		assert.equal(opening.mock.callCount(), 0); assert.equal(f.parts.main.activeGroup.model.tabs.length, 0);
		assert.ok(inputFocus.admittedTarget === focused && f.main.primary === primary && primary.consumer.selection === selected);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	});

test('hiding Main hierarchy preserves the exact pending Details field and its source authority through composition updates', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, '31', true);
	const selected = primary.consumer.selection, commonGeneration = primary.scope.contextGeneration;
	const detailsGeneration = primary.details.scope.contextGeneration;
	f.main.setRegionVisible('hierarchy', false); f.update();
	assert.equal(primary.hierarchy.control.hasView, false); assert.equal(primary.details.control.hasView, true);
	assert.equal(primary.scope.contextGeneration, commonGeneration); assert.equal(primary.details.scope.contextGeneration, detailsGeneration);
	assert.ok(inputFocus.admittedTarget === field.field.focusTarget && primary.consumer.selection === selected);
	assert.equal(field.pending, true); assert.equal(field.field.text, '31'); assert.equal(f.model.buffer.getText(), SOURCE);
	f.key('Enter');
	assert.equal(field.pending, false); assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 31,'));
	assert.equal(primary.hierarchy.control.hasView, false); assert.equal(primary.details.scope.contextGeneration, detailsGeneration);
	assert.ok(primary.consumer.selection?.kind === 'member' && primary.consumer.selection.entry === primary.consumer.subject!.objects[0]);
	const consumers = [...f.main.workingCopyConsumers()]; assert.equal(consumers.length, 1); assert.ok(consumers[0] === primary.consumer);
});

for (const region of ['hierarchy', 'details'] as const)
	test(`hiding Main ${region} revokes its armed native popup without retiring the other region`, async t => {
		const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
		primary[region].focus();
		assert.ok(inputFocus.admittedTarget !== null && primary[region].scope.contains(inputFocus.admittedTarget.scope));
		const origin = inputFocus.admittedTarget!, menu = f.editor.contextMenu;
		f.editor.commands.execute('contextMenu', origin); assert.equal(menu.visible, true);
		menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === 'editor.source');
		assert.ok(menu.model.selectedIndex >= 0 && menu.model.rows[menu.model.selectedIndex].enabled);
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
		const request = t.mock.method(f.editor.navigation, 'openSource');
		const sibling = region === 'hierarchy' ? primary.details : primary.hierarchy;
		const siblingGeneration = sibling.scope.contextGeneration, selected = primary.consumer.selection;
		f.main.setRegionVisible(region, false); f.update();
		assert.equal(menu.visible, false); assert.equal(sibling.scope.contextGeneration, siblingGeneration);
		assert.ok(sibling.control.hasView && primary.consumer.selection === selected);
		f.main.setRegionVisible(region, true); f.update();
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
		assert.equal(menu.visible, false); assert.equal(request.mock.callCount(), 0);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.ok(f.main.primary === primary);
	});

test('Main Back returns to the exact same-named member and invoking Details region without reopening an authored document', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 2), true); f.update(); primary.details.focus();
	resetNavigationHistoryState();
	const group = f.parts.main.activeGroup;
	await f.editor.navigation.openResource(group, f.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	assert.ok(navigationState.activeOwner === group);
	f.main.setRegionVisible('details', false); f.update();
	assert.ok(inputFocus.admittedTarget !== null && group.focusScope.contains(inputFocus.admittedTarget.scope));
	await f.editor.navigation.goBackward(); f.update();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient && restored !== primary);
	const selected = restored.consumer.selection;
	assert.ok(selected?.kind === 'member' && selected.scene === restored.consumer.document!.scenes[0]
		&& selected.entry === selected.scene.objects[1]);
	assert.ok(inputFocus.admittedTarget !== null && restored.details.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(restored.view.preferredPart, 'details'); assert.equal(f.main.regionLayout.detailsVisible, true);
	assert.ok(navigationState.activeOwner === f.main);
	assert.ok(f.parts.groups.every(group => group.model.tabs.every(input => input.kind !== 'scene_editor')));
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});

test('Main center remains the actual document input owner between contextual regions and never acquires a fabricated authored viewport', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const group = f.parts.main.activeGroup, input = new CodeEditorInput(f.firstInput.workingCopy);
	group.openEditor(input); f.update(); primary.hierarchy.focus();
	const selected = primary.consumer.selection, execution = f.host.execution.revision;
	const bounds = group.paneSurface.getBounds(), x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	assert.equal(f.editor.surfaces.hitTest(x, y), group.paneSurface);
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.ok(inputFocus.admittedTarget !== null && group.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(inputFocus.admittedTarget!.guestInput, undefined);
	assert.ok(navigationState.activeOwner === group && f.main.primary === primary && primary.consumer.selection === selected);
	assert.ok(primary.hierarchy.control.hasView && primary.details.control.hasView);
	assert.equal(f.host.execution.revision, execution); assert.ok(group.model.activeTab === input);
});

test('unbound and unavailable Main retain honest document routing without choosing a substitute authored subject', async t => {
	const f = await fixture(t, false), group = f.parts.main.activeGroup, execution = f.host.execution.revision;
	group.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	assert.equal(f.main.primary, undefined); assert.deepEqual([...f.main.workingCopyConsumers()], []);
	group.focus(); assert.ok(navigationState.activeOwner === group);
	assert.equal(await f.open(1), true); f.update();
	const saved = f.main.serialize();
	f.model.pushEditOperations([{ offset: 0, deleteLength: SOURCE.length, text: '-- unavailable authored subject\nreturn {}\n' }]);
	const request = f.main.beginRestore();
	try { assert.equal(await request.restore(saved, (...args) => f.editor.restorePrimaryClient(...args)), true); }
	finally { request.dispose(); }
	f.update(); const unavailable = f.main.primary; assert.ok(unavailable instanceof UnavailableScenePrimaryClient);
	group.focus(); assert.ok(navigationState.activeOwner === group);
	assert.ok(f.main.primary === unavailable && group.model.activeTab?.kind === 'code_editor');
	assert.equal(f.host.execution.revision, execution);
	assert.ok([...f.parts.groups].every(group => group.model.tabs.every(input => input.kind !== 'scene_editor')));
});

test('resizing and hiding a named region during awaited primary recovery retain the newer placement and actual focus', async t => {
	const f = await fixture(t), original = f.main.primary; assert.ok(original instanceof ScenePrimaryClient);
	const group = f.parts.main.activeGroup; group.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.main.focusPrimary('hierarchy');
	const snapshot = f.main.serialize(), request = f.main.beginRestore(), ready = Promise.withResolvers<void>();
	let started = false;
	const restoring = request.restore(snapshot, async (...args) => {
		started = true; await ready.promise; return f.editor.restorePrimaryClient(...args);
	});
	assert.equal(started, true);
	const sash = f.main.regionLayout.hierarchySashBounds, x = (sash.left + sash.right) / 2, y = (sash.top + sash.bottom) / 2;
	const oldWidth = f.main.regionLayout.hierarchyWidth;
	for (const phase of ['down', 'move', 'up'] as const) f.editor.dispatchPointer({ x: phase === 'down' ? x : x + 29, y,
		buttons: phase === 'up' ? 0 : PointerButton.Primary,
		pressedButtons: phase === 'down' ? PointerButton.Primary : 0,
		releasedButtons: phase === 'up' ? PointerButton.Primary : 0,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.main.setRegionVisible('details', false); group.focus(); f.update();
	const width = f.main.regionLayout.hierarchyWidth, focused = inputFocus.admittedTarget;
	assert.ok(focused !== null && group.focusScope.contains(focused.scope));
	assert.notEqual(width, oldWidth); assert.equal(f.main.regionLayout.detailsVisible, false);
	ready.resolve();
	try {
		assert.equal(await restoring, true); request.focusClient(); f.update();
		const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient && restored !== original);
		assert.ok(restored.consumer.subject === restored.consumer.document!.scenes[0]);
		assert.equal(f.main.regionLayout.hierarchyWidth, width); assert.equal(f.main.regionLayout.detailsVisible, false);
		assert.equal(restored.details.control.hasView, false); assert.equal(restored.hierarchy.control.hasView, true);
		assert.ok(inputFocus.admittedTarget === focused);
		const persisted = f.main.serialize(); assert.equal(persisted.hierarchyWidth, width); assert.equal(persisted.detailsVisible, false);
	} finally { request.dispose(); }
});

test('a narrow Main reveals either actual contextual region without replacing the subject or hiding the other retained presentation', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const selected = primary.consumer.selection;
	f.editor.updateViewport({ width: 300, height: 320 }); f.editor.setFontVariant('msx'); f.update();
	for (const region of ['details', 'hierarchy'] as const) {
		f.main.focusPrimary(region); f.update();
		const focused = inputFocus.admittedTarget;
		assert.ok(focused !== null && primary[region].scope.contains(focused.scope));
		assert.equal(f.editor.commands.isEnabled('editor.source', focused), true);
		assert.ok(primary.hierarchy.attached && primary.details.attached);
		assert.ok(f.main.primary === primary && primary.consumer.selection === selected);
	}
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});

for (const region of ['hierarchy', 'details'] as const)
	test(`Main ${region} Tab stays in its actual panel action/body/field boundary`, async t => {
		const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
		const panel = primary[region], selected = primary.consumer.selection, execution = f.host.execution.revision;
		const fields = region === 'details' ? [...primary.details.control.controls, ...primary.details.control.options.controls]
			.filter(control => control.field.focusTarget.canFocus!()).map(control => control.field.focusTarget) : [];
		if (region === 'details') assert.ok(fields.includes(primary.details.control.controls[0].field.focusTarget)
			&& fields.includes(primary.details.control.options.controls[0].field.focusTarget));
		const cycle = [panel.actionBar.focusTarget, panel.control.focusTarget, ...fields];
		assert.equal(cycle[0].focus(), true);
		for (let index = 1; index <= cycle.length; index++) {
			f.key('Tab'); assert.ok(inputFocus.admittedTarget === cycle[index % cycle.length]);
		}
		for (let index = cycle.length - 1; index >= 0; index--) {
			f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === cycle[index]);
		}
		assert.ok(f.main.primary === primary && primary.consumer.selection === selected);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
		assert.equal(f.host.execution.revision, execution);
	});

test('hiding the focused Main Details region requires its actual draft acceptance before retiring its authority', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, 'not a number', true);
	const generation = primary.details.scope.contextGeneration;
	assert.equal(f.main.setRegionVisible('details', false), false); f.update();
	assert.equal(f.main.regionLayout.detailsVisible, true); assert.equal(primary.details.attached, true);
	assert.equal(primary.details.scope.contextGeneration, generation);
	assert.ok(inputFocus.admittedTarget === field.field.focusTarget && field.pending);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	setFieldText(field.field, '31', true);
	assert.equal(f.main.setRegionVisible('details', false), true); f.update();
	assert.equal(field.pending, false); assert.equal(primary.details.attached, false);
	assert.ok(primary.hierarchy.attached && primary.details.scope.contextGeneration > generation);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 31,'));
	assert.equal(f.parts.main.contentPresented, false);
	assert.ok(inputFocus.admittedTarget !== null && primary.viewport.scope.contains(inputFocus.admittedTarget.scope));
});

test('a real Details toolbar Source invocation keeps its native region authority instead of borrowing the shared semantic root lifetime', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const ready = Promise.withResolvers<void>(), capture = primary.consumer.captureSourceLocation.bind(primary.consumer);
	t.mock.method(primary.consumer, 'captureSourceLocation', () => {
		const lease = capture();
		return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
	});
	assert.equal(primary.details.actionBar.focusTarget.focus(), true); f.key('Home');
	const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
	f.key('Enter'); assert.equal(request.mock.callCount(), 1); assert.equal(opening.mock.callCount(), 0);
	const generation = primary.scope.contextGeneration;
	f.main.setRegionVisible('details', false); f.update(); const focused = inputFocus.admittedTarget;
	assert.equal(primary.scope.contextGeneration, generation); assert.ok(primary.hierarchy.attached);
	ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
	assert.equal(opening.mock.callCount(), 0); assert.ok(f.main.primary === primary && inputFocus.admittedTarget === focused);
	assert.equal(f.parts.main.activeGroup.model.tabs.length, 0); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('a Main region hide cannot steal a newer document interaction published by its own draft acceptance', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, '31', true);
	let published = false;
	const release = f.model.onDidChangeContent(() => { release(); published = true; f.second.focus(); }); t.after(release);
	assert.equal(f.main.setRegionVisible('details', false), false); f.update();
	assert.equal(published, true); assert.equal(field.pending, false);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 31,'));
	assert.equal(f.main.regionLayout.detailsVisible, true); assert.ok(primary.details.attached && f.main.primary === primary);
	assert.ok(inputFocus.admittedTarget !== null && f.secondPart.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(navigationState.activeOwner === f.secondGroup);
});

test('a restored layout publication cannot overwrite newer placement or admit its old source factory', async t => {
	const f = await fixture(t), request = f.main.beginRestore();
	const snapshot = { ...f.main.serialize(), hierarchyVisible: false, detailsWidth: 270 };
	let newer: Promise<boolean> | undefined, factoryCalls = 0;
	const release = f.main.onDidChange(() => {
		release();
		f.main.regionLayout.detailsWidth = 319;
		assert.equal(f.main.setRegionVisible('details', false), true);
		newer = f.open(1);
	}); t.after(release);
	try {
		assert.equal(await request.restore(snapshot, (...args) => { factoryCalls++; return f.editor.restorePrimaryClient(...args); }), false);
		assert.equal(await newer, true); f.update();
		const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[1]);
		assert.equal(factoryCalls, 0); assert.equal(f.main.regionLayout.detailsWidth, 319);
		assert.equal(f.main.regionLayout.detailsVisible, false); assert.equal(primary.details.attached, false);
	} finally { request.dispose(); }
});

for (const change of ['none', 'return-focus retirement', 'pending Source retirement'] as const)
	test(`Main Details Palette Source retains its actual primary origin (${change})`, async t => {
		const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		const group = f.parts.main.activeGroup; group.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
		assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 2), true); f.update(); primary.details.focus();
		const origin = inputFocus.admittedTarget!, selected = primary.consumer.selection;
		const ready = Promise.withResolvers<void>();
		if (change === 'pending Source retirement') {
			const capture = primary.consumer.captureSourceLocation.bind(primary.consumer);
			t.mock.method(primary.consumer, 'captureSourceLocation', () => {
				const lease = capture();
				return { ...lease, readLocation: async () => { await ready.promise; return lease.readLocation(); } };
			});
		}
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		const picker = f.editor.quickInput;
		assert.equal(picker.visible, true); assert.ok(picker.invocationOrigin === origin);
		const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'editor.source');
		assert.ok(index >= 0, 'the primary origin exposes shared Source independently of the center document');
		f.key('Home', KeyModifier.ctrl); for (let count = 0; count < index; count++) f.key('ArrowDown');
		const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
		let retired = false;
		if (change === 'return-focus retirement') {
			const release = origin.onDidFocus(() => {
				release(); retired = true;
				f.main.setRegionVisible('details', false); f.main.setRegionVisible('details', true);
			}); t.after(release);
		}
		f.key('Enter'); assert.equal(picker.visible, false);
		if (change === 'return-focus retirement') {
			assert.equal(retired, true); assert.equal(request.mock.callCount(), 0); assert.equal(opening.mock.callCount(), 0);
			assert.ok(primary.details.attached && primary.consumer.selection === selected);
		} else if (change === 'pending Source retirement') {
			assert.equal(request.mock.callCount(), 1); assert.equal(opening.mock.callCount(), 0);
			f.main.setRegionVisible('details', false); f.update(); const focused = inputFocus.admittedTarget;
			ready.resolve(); assert.equal(await request.mock.calls[0].result, undefined);
			assert.equal(opening.mock.callCount(), 0); assert.ok(inputFocus.admittedTarget === focused);
		} else {
			assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
			const input = group.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
			const position = { row: 0, column: 0 }; f.model.buffer.positionAt(primary.consumer.selectionRange.start, position);
			assert.equal(input.context.view.cursorRow, position.row); assert.equal(input.context.view.cursorColumn, position.column);
		}
		assert.ok(f.main.primary === primary && primary.consumer.selection === selected);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	});

test('a stable Main frame updates each actual region body once without redoing its container allocation', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update();
	const hierarchyLayout = t.mock.method(primary.hierarchy.control, 'layout'), detailsLayout = t.mock.method(primary.details.control, 'layout');
	const hierarchyUpdate = t.mock.method(primary.hierarchy.control, 'update'), detailsUpdate = t.mock.method(primary.details.control, 'update');
	const field = primary.details.control.controls[0], selected = primary.consumer.selection;
	f.update();
	assert.equal(hierarchyLayout.mock.callCount(), 0); assert.equal(detailsLayout.mock.callCount(), 0);
	assert.equal(hierarchyUpdate.mock.callCount(), 1); assert.equal(detailsUpdate.mock.callCount(), 1);
	assert.ok(primary.details.control.controls[0] === field && primary.consumer.selection === selected);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});

test('newer placement from restore publication survives without cancelling independent primary recovery', async t => {
	const f = await fixture(t), original = f.main.primary, request = f.main.beginRestore();
	const snapshot = { ...f.main.serialize(), hierarchyVisible: false, detailsWidth: 270 };
	let published = false;
	const release = f.main.onDidChange(() => {
		release(); published = true;
		f.main.regionLayout.detailsWidth = 319;
		assert.equal(f.main.setRegionVisible('details', false), true);
	}); t.after(release);
	try {
		assert.equal(await request.restore(snapshot, (...args) => f.editor.restorePrimaryClient(...args)), true); f.update();
		const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient && primary !== original);
		assert.equal(published, true); assert.ok(primary.consumer.subject === primary.consumer.document!.scenes[0]);
		assert.equal(f.main.regionLayout.detailsWidth, 319); assert.equal(f.main.regionLayout.detailsVisible, false);
		assert.equal(primary.details.attached, false); assert.equal(f.model.buffer.getText(), SOURCE);
	} finally { request.dispose(); }
});

test('a Main region hide cannot retire Details reacquired by its intended document-focus callback', async t => {
	const f = await fixture(t), primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const group = f.parts.main.activeGroup; group.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const document = group.panes.activePane!; primary.details.focus();
	let published = false;
	const release = document.commandTarget.onDidFocus(() => {
		release(); published = true; f.main.focusPrimary('details');
	}); t.after(release);
	assert.equal(f.main.setRegionVisible('details', false), false); f.update();
	assert.equal(published, true); assert.equal(f.main.regionLayout.detailsVisible, true);
	assert.ok(primary.details.attached && f.main.primary === primary);
	assert.ok(inputFocus.admittedTarget !== null && primary.details.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(navigationState.activeOwner === f.main); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});
