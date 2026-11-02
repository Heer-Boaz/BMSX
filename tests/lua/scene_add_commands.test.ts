import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { CARTLIB_OBJECT_SOURCE_MODULES } from '../fixtures/studio/cartlib_objects';
import { createActualSourcePanes } from '../helpers/source_panes';
import { WORKBENCH_ACTION_BAR_OVERFLOW } from '../../ide/workbench/ui/action_bar';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
prefab.define({def_id='other',class=require('cartlib/world/object_2d')})
prefab.define({def_id='mesh',class=require('cartlib/world/object_3d')})`;
const SOURCE = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('main',{objects={{member_id='old',definition_id='actor',position={x=0,y=0}}}})
scenes.register('replacement',{objects={{member_id='untouched',definition_id='actor'}}})`;

async function fixture(t: TestContext, source = SOURCE) {
	const f = createActualSourcePanes(t, false, [...CARTLIB_OBJECT_SOURCE_MODULES,
		['scene.lua', source], ['prefabs.lua', PREFABS], ['cartlib/world/scene_library.lua', 'return {}'],
		['cartlib/world/prefab.lua', 'return {define=function() end}']]);
	f.editor.setFontVariant('tiny'); f.editor.editorParts.clear();
	const main = f.editor.mainWorkspace;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const provider = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'prefabs.lua' })!);
	const open = async (index: number) => {
		const document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(() => ({ model,
			subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), main.focusTarget), true);
		f.update();
		const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		const camera = primary.view.viewport.camera, state = camera.capture();
		camera.restore({ ...state, mode: '2d', modeIntent: 'manual', canvas: { centerX: 0, centerY: 0, scale: 1, reading: 'manual' } });
		main.focusPrimary('hierarchy'); f.update();
		return primary;
	};
	const primary = await open(0), picker = f.editor.quickInput;
	return { ...f, main, model, provider, primary, picker, open };
}

test('Main dynamic composition row retains Source without object commands', async t => {
	const source = SOURCE.replace('objects={{', 'objects={make_object(),{');
	const f = await fixture(t, source);
	f.key('Home'); f.key('ArrowDown'); f.key('ContextMenu');
	assert.equal(f.editor.contextMenu.visible, true);
	const selection = f.primary.consumer.selection;
	assert.ok(selection?.kind === 'member' && selection.entry.kind === 'dynamic');
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), ['editor.source']);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});

for (const subject of ['scene', 'dynamic'] as const) test(`Main row Source opens the ${subject} occurrence`, async t => {
	const source = SOURCE.replace('objects={{', 'objects={make_object(),{');
	const f = await fixture(t, source);
	const document = f.primary.consumer.document!, scene = document.scenes[0], entry = scene.objects[0];
	assert.equal(entry.kind, 'dynamic');
	const range = subject === 'scene' ? scene.range : document.analysis.chunk.locations.range(entry.field.span);
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	f.key('Home'); if (subject === 'dynamic') f.key('ArrowDown'); f.key('ContextMenu'); f.key('Enter');
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.equal(input.context.view.cursorRow, range.start.line - 1);
	assert.equal(input.context.view.cursorColumn, range.start.column - 1);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});
type Fixture = Awaited<ReturnType<typeof fixture>>;

test('empty canvas click clears the shared Scene selection across hierarchy, Details and gizmo', async t => {
	const f = await fixture(t);
	f.key('Home'); f.key('ArrowDown'); f.update();
	const selection = f.primary.consumer.selection, view = f.primary.view;
	assert.ok(selection?.kind === 'member');
	assert.equal(view.hierarchy.outline.selectionIndex, 1);
	assert.equal(view.details.projection.subject?.selection, selection);
	assert.equal(view.viewport.selected, selection.entry);
	assert.notEqual(view.viewport.gizmo.world, undefined);
	const bounds = f.primary.viewport.layoutState.client, x = bounds.left + 2, y = bounds.top + 2;
	assert.equal(view.viewport.pick(x, y), undefined);
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
		buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0,
		releasedButtons: down ? 0 : PointerButton.Primary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
	assert.equal(f.primary.consumer.selection, undefined);
	assert.equal(view.hierarchy.outline.selectionIndex, -1);
	assert.equal(view.details.projection.subject, undefined);
	assert.equal(view.viewport.selected, undefined);
	assert.equal(view.viewport.gizmo.world, undefined);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('Add acceptance does not arm or reclaim the canvas after focus return selects a newer foreground', async t => {
	const f = await fixture(t), foreign = f.editor.editorParts.createDocument();
	foreign.activeGroup.openEditor(new HomeInput(null)); f.main.focusPrimary('hierarchy'); f.update();
	const arm = t.mock.method(f.primary.viewport.control, 'beginAddMember');
	openAdd(f);
	t.after(f.picker.field.focusTarget.onDidBlur(() => foreign.activeGroup.focus()));
	f.key('Enter');
	assert.equal(f.picker.visible, false); assert.equal(arm.mock.callCount(), 0);
	assert.ok(inputFocus.admittedTarget !== null && foreign.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(f.main.primary, f.primary); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

function openAdd(f: Fixture): void {
	assert.equal(f.editor.commands.isEnabled('sceneEditor.addMember', f.primary.hierarchy.control.focusTarget), true);
	const bar = f.primary.hierarchy.actionBar;
	assert.equal(bar.focusTarget.focus(), true); f.key('Home');
	assert.equal(bar.tooltipItem?.command, 'sceneEditor.addMember'); f.key('Enter');
	assert.equal(f.picker.visible, true); assert.equal(f.picker.busy, false);
	assert.equal(inputFocus.admittedTarget, f.picker.field.focusTarget);
}

function chooseOther(f: Fixture): void {
	const target = f.editor.textTarget; assert.ok(target);
	assert.equal(target.replaceText(0, target.readText().text.length, 'other'), true); f.update();
	assert.equal(f.picker.model.list.rows.length, 1); f.key('Enter');
}

function clickViewport(f: Fixture, primary = f.primary): void {
	const bounds = primary.viewport.layoutState.client;
	const x = (bounds.left + bounds.right) / 2 + 27, y = (bounds.top + bounds.bottom) / 2 - 12;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
		buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0,
		releasedButtons: down ? 0 : PointerButton.Primary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
}

test('Main Add chooses an existing 2D prefab without writing, then the physical canvas click publishes selection and ordinary Undo', async t => {
	const f = await fixture(t); let changes = 0;
	t.after(f.model.onDidChangeContent(() => changes++));
	openAdd(f); chooseOther(f);
	assert.equal(f.picker.visible, false); assert.equal(inputFocus.admittedTarget, f.primary.viewport.control.focusTarget);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false); assert.equal(f.model.canUndo, false); assert.equal(changes, 0);
	clickViewport(f);
	assert.equal(changes, 1); assert.equal(f.model.canUndo, true); assert.equal(f.model.dirty, true);
	const selected = f.primary.consumer.selection!; assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	assert.equal(selected.index, 1); assert.equal(stringLiteralValue(selected.entry.definitionId), 'other');
	assert.equal(f.primary.consumer.selectedLocalTransform!.ox, 27); assert.equal(f.primary.consumer.selectedLocalTransform!.oy, -12);
	assert.equal(f.primary.consumer.subject!.objects.length, 2);
	assert.equal(f.primary.consumer.document!.scenes[1].objects.length, 1, 'the other authored declaration is not the Add target');
	assert.equal(f.provider.buffer.getText(), PREFABS);
	f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
});

test('cancelling the actual Add picker returns to its origin and never arms placement', async t => {
	const f = await fixture(t), origin = f.primary.hierarchy.actionBar.focusTarget;
	openAdd(f); assert.equal(f.picker.invocationOrigin, origin); f.key('Escape');
	assert.equal(f.picker.visible, false); assert.equal(inputFocus.admittedTarget, origin);
	clickViewport(f);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
});

test('secondary click cancels placement before opening the canvas menu, without publishing source', async t => {
	const f = await fixture(t); openAdd(f); chooseOther(f);
	const bounds = f.primary.viewport.layoutState.client, x = (bounds.left + bounds.right) / 2 + 27, y = (bounds.top + bounds.bottom) / 2 - 12;
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: 0,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() }); f.update();
	assert.ok(f.primary.view.viewport.placementPreview !== undefined);
	const secondary = () => {
		for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
			buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
			releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		f.update();
	};
	secondary();
	assert.equal(f.primary.view.viewport.placementPreview, undefined);
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(inputFocus.admittedTarget, f.primary.viewport.control.focusTarget);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	secondary(); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'editor.source'), false);
	f.key('Escape'); f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'editor.source'), false);
});

test('canvas context remains about the canvas when opened over a member', async t => {
	const f = await fixture(t), view = f.primary.view.viewport;
	const bounds = f.primary.viewport.layoutState.client, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	assert.equal(view.pick(x, y), f.primary.consumer.subject!.objects[0]);
	const selection = f.primary.consumer.selection;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
		buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
		releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'editor.source'), false);
	assert.equal(f.primary.consumer.selection, selection);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const [key, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const)
	test(`${key} cancels an armed placement before opening a canvas context menu`, async t => {
		const f = await fixture(t); openAdd(f); chooseOther(f);
		assert.equal(inputFocus.admittedTarget, f.primary.viewport.control.focusTarget);
		f.key(key, modifiers);
		assert.equal(f.editor.contextMenu.visible, false);
		assert.equal(f.primary.view.viewport.placementPreview, undefined);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
		f.key(key, modifiers); assert.equal(f.editor.contextMenu.visible, true);
	});

test('canvas context closes when departing field focus publishes a newer source generation', async t => {
	const f = await fixture(t); f.key('Home'); f.key('ArrowDown'); f.main.focusPrimary('details');
	const field = f.primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	const target = f.editor.textTarget!; assert.equal(target.replaceText(0, target.readText().text.length, '41.5'), true);
	const bounds = f.primary.viewport.layoutState.client, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
		buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
		releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.primary.consumer.selectedLocalTransform!.ox, 41.5);
	assert.equal(f.model.canUndo, true); f.model.undo(); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('canvas context retires with its Scene attachment before a replacement is presented', async t => {
	const f = await fixture(t); f.main.focusPrimary('viewport'); f.key('ContextMenu');
	assert.equal(f.editor.contextMenu.visible, true);
	const replacement = await f.open(1);
	assert.notEqual(replacement, f.primary); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	f.main.focusPrimary('viewport'); f.key('ContextMenu');
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(f.main.primary, replacement);
});

test('a viewport presented in another window keeps placement and popup ownership with that window', async t => {
	const f = await fixture(t), panel = f.primary.viewport, surfaces = f.editor.surfaces, bounds = panel.layoutState.client;
	const floating = surfaces.attach({ role: 'window', captureScope: Symbol('floating viewport'), lifetimeOwner: f.main.surface,
		presentationParent: f.main.surface, isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	t.after(() => floating.dispose());
	surfaces.reparent(panel.surface, floating);
	assert.equal(surfaces.windowContext(panel.surface), floating);
	openAdd(f); chooseOther(f);
	const x = (bounds.left + bounds.right) / 2 + 27, y = (bounds.top + bounds.bottom) / 2 - 12;
	const secondary = () => {
		for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
			buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
			releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		f.update();
	};
	secondary(); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.primary.view.viewport.placementPreview, undefined);
	secondary(); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.invocationOrigin, panel.control.focusTarget);
	assert.equal(surfaces.isInWindowFamily(f.editor.contextMenu.pointerScope, floating.captureScope), true);
	floating.dispose();
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(panel.attached, false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const region of ['hierarchy', 'details'] as const) for (const route of ['overflow', 'secondary'] as const)
	test(`Main Scene ${region} header ${route} contains only panel commands, never selected-member actions`, async t => {
		const f = await fixture(t), panel = f.primary[region];
		f.main.focusPrimary('hierarchy'); f.key('Home'); f.key('ArrowDown');
		const selection = f.primary.consumer.selection;
		assert.ok(selection?.kind === 'member');
		assert.equal(panel.actionBar.focusTarget.focus(), true); f.key('End');
		assert.equal(panel.actionBar.tooltipItem?.command, WORKBENCH_ACTION_BAR_OVERFLOW);
		if (route === 'overflow') f.key('Enter');
		else {
			const bounds = panel.actionBar.tooltipItem.bounds;
			const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
			for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
				buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
				releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
				modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		}
		const rows = f.editor.contextMenu.model.rows;
		assert.equal(f.editor.contextMenu.visible, true);
		assert.ok(rows.some(row => row.command === `workspace.${region}.toggle`));
		assert.equal(rows.some(row => row.command === 'editor.source' || row.command === 'sceneEditor.renameMember'
			|| row.command === 'sceneEditor.reparentMember' || row.command === 'sceneEditor.reparentMemberKeepLocal'
			|| row.command === 'sceneEditor.removeMember' || row.command === 'sceneEditor.removeSubtree'), false);
		assert.equal(f.primary.consumer.selection?.kind, 'member');
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	});

test('Main hierarchy row menu owns member commands but not Add or panel chrome', async t => {
	const f = await fixture(t);
	f.key('Home'); f.key('ArrowDown'); f.key('ContextMenu');
	assert.equal(f.editor.contextMenu.visible, true);
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), [
		'editor.source', 'sceneEditor.renameMember', 'sceneEditor.reparentMember', 'sceneEditor.removeMember', 'sceneEditor.removeSubtree',
	], 'the clicked-member menu has one reparent operation and no commands for another subject');
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const route of ['pointer', 'keyboard'] as const) test(`Main hierarchy ${route} menu follows the selected scene or member`, async t => {
	const f = await fixture(t);
	const showRow = (index: number): void => {
		if (route === 'keyboard') { f.key(index === 0 ? 'Home' : 'ArrowDown'); f.key('ContextMenu'); return; }
		const tree = f.primary.view.hierarchy.outline, row = tree.rows[index], layout = tree.layout;
		const x = layout.contentLeft + (row.depth + 1.5) * layout.indentWidth;
		const y = layout.contentTop + (index - tree.scroll + 0.5) * layout.rowHeight;
		for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
			buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
			releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	};
	showRow(0);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.primary.consumer.selection?.kind, 'scene');
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), ['editor.source']);
	f.key('Escape'); showRow(1);
	assert.equal(f.primary.consumer.selection?.kind, 'member');
	const rows = f.editor.contextMenu.model.rows;
	assert.ok(rows.some(row => row.command === 'editor.source'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.renameMember'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.reparentMember'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.removeMember'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.removeSubtree'));
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const route of ['pointer', 'ContextMenu', 'F10'] as const)
	test(`Main Details ${route} never opens an empty inspector menu or borrows the selected member menu`, async t => {
		const f = await fixture(t);
		f.key('Home'); f.key('ArrowDown'); f.main.focusPrimary('details');
		assert.equal(f.primary.details.control.focus(), true);
		const selection = f.primary.consumer.selection, source = f.model.buffer.getText();
		const show = t.mock.method(f.editor.contextMenu, 'show');
		if (route === 'pointer') {
			const bounds = f.primary.view.details.viewport.bounds, x = bounds.left + 1, y = bounds.top + 1;
			for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
				buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
				releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
				modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		} else f.key(route, route === 'F10' ? KeyModifier.shift : KeyModifier.none);
		assert.equal(show.mock.callCount(), 0, 'an empty inspector menu is rejected before popup construction');
		assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.primary.consumer.selection, selection);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
	});

test('undoing a placed member from Details retains its source owner for keyboard Redo', async t => {
	const f = await fixture(t); openAdd(f); chooseOther(f); clickViewport(f);
	const inserted = f.model.buffer.getText();
	f.main.focusPrimary('details');
	const field = f.primary.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true);
	const text = f.editor.textTarget!;
	assert.equal(text.replaceText(0, text.readText().text.length, '41'), true); f.key('Enter'); f.update();
	assert.equal(f.primary.consumer.selectedLocalTransform!.ox, 41);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(f.model.buffer.getText(), inserted);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canRedo, true);
	assert.ok(inputFocus.admittedTarget !== null && f.primary.scope.contains(inputFocus.admittedTarget.scope));
	f.key('KeyZ', KeyModifier.ctrl | KeyModifier.shift); f.update();
	assert.equal(f.model.buffer.getText(), inserted); assert.equal(f.primary.consumer.subject!.objects.length, 2);
});

for (const retirement of ['source', 'provider', 'read-only', 'selection'] as const)
	test(`${retirement} while the Add picker is open revokes its source choice before canvas placement`, async t => {
		const f = await fixture(t); openAdd(f);
		if (retirement === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external\n' }]);
		else if (retirement === 'provider') {
			f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- provider\n' }]);
			f.primary.consumer.refresh();
		} else if (retirement === 'read-only') f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
		else {
			const context = f.primary.consumer, scene = context.subject!;
			assert.equal(context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
		}
		assert.equal(f.picker.visible, false);
		const source = f.model.buffer.getText(), version = f.model.version, canUndo = f.model.canUndo;
		f.key('Enter'); clickViewport(f);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, canUndo);
		assert.equal(f.primary.consumer.subject!.objects.length, 1);
	});

test('a retired Main primary cannot hand its Add picker choice to the replacement canvas', async t => {
	const f = await fixture(t); openAdd(f);
	const replacement = await f.open(1);
	assert.notEqual(replacement, f.primary); assert.equal(f.picker.visible, false);
	f.key('Enter'); clickViewport(f, replacement);
	assert.equal(f.main.primary, replacement); assert.equal(replacement.consumer.subject!.objects.length, 1);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
});

for (const valid of [true, false]) test(`the physical hierarchy Add action ${valid ? 'commits a valid Details draft before opening its picker' : 'rejects an invalid Details draft without taking focus'}`, async t => {
	const f = await fixture(t), hierarchy = f.primary.hierarchy.control;
	assert.equal(hierarchy.focus(), true); f.key('Home'); f.key('ArrowDown');
	const selected = f.primary.consumer.selection!; assert.ok(selected.kind === 'member' && selected.index === 0);
	const bar = f.primary.hierarchy.actionBar;
	assert.equal(bar.focusTarget.focus(), true); f.key('Home');
	const visited = new Set<string | symbol>();
	while (bar.tooltipItem?.command !== 'sceneEditor.addMember') {
		const item = bar.tooltipItem; assert.ok(item);
		assert.equal(visited.has(item.command), false, 'Add is keyboard-reachable in the actual hierarchy action bar');
		visited.add(item.command); f.key('ArrowRight');
	}
	const bounds = bar.tooltipItem.bounds;
	f.main.focusPrimary('details'); const field = f.primary.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true);
	const target = f.editor.textTarget!;
	assert.equal(target.replaceText(0, target.readText().text.length, valid ? '41.5' : 'not_a_number'), true); f.update();
	assert.equal(field.pending, true); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	let changes = 0;
	t.after(f.model.onDidChangeContent(() => {
		changes++; assert.equal(f.picker.visible, false, 'command admission publishes the old draft before creating the Add popup');
	}));
	// These bounds identify a public action input target; their size and position are not asserted.
	const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(inputFocus.admittedTarget, field.field.focusTarget);
	assert.equal(field.pending, true); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.picker.visible, false);
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
	if (valid) {
		assert.equal(changes, 1); assert.equal(field.pending, false); assert.equal(f.primary.consumer.selectedLocalTransform!.ox, 41.5);
		assert.equal(f.picker.visible, true); assert.equal(f.picker.busy, false);
		assert.equal(inputFocus.admittedTarget, f.picker.field.focusTarget);
		assert.equal(f.primary.consumer.subject!.objects.length, 1, 'accepting the old draft does not itself place another member');
		f.key('Escape'); f.main.focusPrimary('viewport'); f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	} else {
		assert.equal(changes, 0); assert.equal(f.picker.visible, false); assert.equal(field.pending, true); assert.notEqual(field.error, '');
		assert.equal(inputFocus.admittedTarget, field.field.focusTarget);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
		f.key('Escape');
	}
});


test('viewport mode commands publish mutually exclusive checked state through the shared context menu', async t => {
	const f = await fixture(t), target = f.primary.viewport.control.focusTarget;
	const bounds = f.primary.view.viewport.bounds, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	for (const mode of ['2d', '3d'] as const) {
		f.editor.commands.execute(mode === '2d' ? 'sceneViewport.view2d' : 'sceneViewport.view3d', target); f.update();
		for (const down of [true, false]) f.editor.dispatchPointer({ x, y,
			buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
			releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		f.update(); assert.equal(f.editor.contextMenu.visible, true);
		for (const candidate of ['2d', '3d'] as const) {
			const row = f.editor.contextMenu.model.rows.find(row => row.command === (candidate === '2d' ? 'sceneViewport.view2d' : 'sceneViewport.view3d'))!;
			assert.equal(row.active, candidate === mode); assert.equal(row.enabled, true);
		}
		f.key('Escape'); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	}
});
