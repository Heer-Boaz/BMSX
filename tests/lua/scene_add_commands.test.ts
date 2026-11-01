import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { CARTLIB_OBJECT_SOURCE_MODULES } from '../fixtures/studio/cartlib_objects';
import { createActualSourcePanes } from '../helpers/source_panes';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
prefab.define({def_id='other',class=require('cartlib/world/object_2d')})
prefab.define({def_id='mesh',class=require('cartlib/world/object_3d')})`;
const SOURCE = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('main',{objects={{member_id='old',definition_id='actor',position={x=0,y=0}}}})
scenes.register('replacement',{objects={{member_id='untouched',definition_id='actor'}}})`;

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [...CARTLIB_OBJECT_SOURCE_MODULES,
		['scene.lua', SOURCE], ['prefabs.lua', PREFABS], ['cartlib/world/scene_library.lua', 'return {}'],
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
type Fixture = Awaited<ReturnType<typeof fixture>>;

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
	f.key('ContextMenu'); const menu = f.editor.contextMenu;
	assert.equal(menu.visible, true);
	assert.ok(menu.model.rows.some(row => row.command === 'sceneEditor.addMember' && row.enabled),
		'the real hierarchy menu contributes an admitted Add command');
	for (let step = 0; menu.model.rows[menu.model.selectedIndex]?.command !== 'sceneEditor.addMember' && step < menu.model.rows.length; step++) f.key('ArrowDown');
	assert.equal(menu.model.rows[menu.model.selectedIndex].command, 'sceneEditor.addMember'); f.key('Enter');
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
	const f = await fixture(t), origin = f.primary.hierarchy.control.focusTarget;
	openAdd(f); assert.equal(f.picker.invocationOrigin, origin); f.key('Escape');
	assert.equal(f.picker.visible, false); assert.equal(inputFocus.admittedTarget, origin);
	clickViewport(f);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
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
