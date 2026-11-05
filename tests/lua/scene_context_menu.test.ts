import type { LuaTableConstructorExpression } from '../../toolchain/ts/lua/syntax/ast';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createLuaTableFieldRemovalEdits, luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { WORKBENCH_ACTION_BAR_OVERFLOW } from '../../ide/workbench/ui/action_bar';

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny', source = SCENE_VIEWPORT_SOURCE, composition = false) {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source], ['cartlib/world/scene_library.lua', 'return {}'],
		['cartlib/component/rectangle_component.lua', 'return {new=function() end}']]);
	f.editor.setFontVariant(font);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.editorParts.minimize(f.firstPart);
	const firstPart = f.editor.editorParts.main, firstGroup = firstPart.activeGroup;
	f.editor.sceneEditor.openResource(firstGroup, resource);
	if (composition) {
		const input = firstGroup.model.activeTab; assert.ok(input instanceof SceneEditorInput);
		const scene = input.view.authoring.scenes[0];
		assert.equal(f.editor.sceneEditor.openDefinition(firstGroup, resource, luaSourceRangeToTextRange(input.workingCopy.buffer, scene.range)), true);
	}
	const input = firstGroup.model.activeTab; assert.ok(input instanceof SceneEditorInput);
	f.update(); const pane = firstGroup.panes.activePane!; assert.ok(pane instanceof SceneEditorPane); pane.focus();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	f.editor.mainWorkspace.focusPrimary('hierarchy'); f.update();
	assert.equal(editorViewState.font.variant, font);
	return { ...f, firstGroup, firstPart, primary, pane, input, model: input.workingCopy };
}

test('document dynamic composition row retains Source without object commands', t => {
	const source = SCENE_VIEWPORT_SOURCE.replace('objects = {', 'objects = { make_object(),');
	const f = fixture(t, 'tiny', source);
	secondary(f, 1);
	assert.equal(f.editor.contextMenu.visible, true);
	const selection = f.input.view.authoring.selection;
	assert.ok(selection?.kind === 'member' && selection.entry.kind === 'dynamic');
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), ['editor.source']);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});
type Fixture = ReturnType<typeof fixture>;
/** Coordinates only locate the actual outline row; workflow assertions concern source and owned selection. */
function secondary(f: Fixture, index: number, gutter = false): void {
	const tree = f.input.view.hierarchy.outline, row = tree.rows[index], layout = tree.layout;
	const x = layout.contentLeft + (row.depth + (gutter ? 0.5 : 1.5)) * layout.indentWidth;
	const y = layout.contentTop + (index - tree.scroll + 0.5) * layout.rowHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10); f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y, buttons: down ? PointerButton.Secondary : 0,
			pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
}
function accept(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu, index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled);
	f.key('Home'); for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown'); f.key('Enter');
}

const VIEWPORT_MENU_SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local rectangle=require('cartlib/component/rectangle_component')
prefab.define({def_id='tile',class=require('cartlib/world/object_2d'),
 components={function(owner) return rectangle.new(owner,{width=32,height=24,color=0xff00ff00}) end}})
scenes.register('context',{objects={
 {member_id='left',definition_id='tile',position={x=0,y=0}},
 {member_id='right',definition_id='tile',position={x=80,y=0}},
}})`;

/** Locate the centre of the actual visual, not its origin helper or a fixed screen pixel. */
function viewportVisualPoint(f: Fixture) {
	const view = f.input.view.viewport, quad = view.canvas.items[0], { affine, width, height } = quad;
	const wx = affine.ox + (affine.xx * width + affine.yx * height) / 2;
	const wy = (affine.oy + (affine.xy * width + affine.yy * height) / 2) * (view.camera.mode === '3d' ? -1 : 1);
	const x = (view.bounds.left + view.bounds.right) / 2 + view.camera.projectX(wx, wy, 0);
	const y = (view.bounds.top + view.bounds.bottom) / 2 + view.camera.projectY(wx, wy, 0);
	assert.ok(view.pick(x, y) === quad.source.entry);
	return { x, y, entry: quad.source.entry };
}
function viewportPointer(f: Fixture, x: number, y: number, buttons: number, pressedButtons = 0, releasedButtons = 0): void {
	f.host.clock.advance(10);
	f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y, buttons, pressedButtons, releasedButtons,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
}

for (const mode of ['2d', '3d'] as const) test(`Scene ${mode} viewport context click selects the visible member only on release`, t => {
	const f = fixture(t, 'tiny', VIEWPORT_MENU_SOURCE, true), view = f.input.view.viewport;
	selectSceneOutlineRow(f.input.view.hierarchy, 2); view.camera.setMode(mode); f.update();
	const previous = f.input.view.authoring.selection, camera = view.camera.capture(), { x, y, entry } = viewportVisualPoint(f);
	viewportPointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
	assert.equal(f.editor.contextMenu.visible, false); assert.ok(f.input.view.authoring.selection === previous);
	viewportPointer(f, x, y, 0, 0, PointerButton.Secondary);
	assert.equal(f.editor.contextMenu.visible, true);
	const selection = f.input.view.authoring.selection;
	assert.ok(selection?.kind === 'member' && selection.entry === entry);
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), [
		'editor.source', 'sceneEditor.inspectLive', 'sceneEditor.renameMember', 'sceneEditor.reparentMember', 'sceneEditor.removeMember', 'sceneEditor.removeSubtree',
	], 'an object hit owns member actions, not canvas creation or camera commands');
	assert.deepEqual(view.camera.capture(), camera);
	assert.equal(f.model.buffer.getText(), VIEWPORT_MENU_SOURCE); assert.equal(f.model.canUndo, false);
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === f.pane.control.focusTarget);
});

for (const mode of ['2d', '3d'] as const) test(`Scene ${mode} right drag over artwork navigates without selecting or opening an object menu`, t => {
	const f = fixture(t, 'tiny', VIEWPORT_MENU_SOURCE, true), view = f.input.view.viewport;
	selectSceneOutlineRow(f.input.view.hierarchy, 2); view.camera.setMode(mode); f.update();
	const selection = f.input.view.authoring.selection, camera = view.camera.capture(), { x, y } = viewportVisualPoint(f);
	viewportPointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
	viewportPointer(f, x + 20, y + 10, PointerButton.Secondary);
	viewportPointer(f, x + 20, y + 10, 0, 0, PointerButton.Secondary);
	assert.equal(f.editor.contextMenu.visible, false); assert.ok(f.input.view.authoring.selection === selection);
	assert.notDeepEqual(view.camera.capture(), camera);
	assert.equal(f.model.buffer.getText(), VIEWPORT_MENU_SOURCE); assert.equal(f.model.canUndo, false);
});

test('Scene viewport keyboard menu uses the selected member even without a projected pose', t => {
	const f = fixture(t, 'tiny', SCENE_VIEWPORT_SOURCE, true); selectSceneOutlineRow(f.input.view.hierarchy, 2); f.update(); f.pane.focus();
	const selection = f.input.view.authoring.selection;
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(f.input.view.authoring.selection === selection);
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.removeMember' && row.enabled));
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === f.pane.control.focusTarget);
	assert.equal(f.model.canUndo, false);
});

test('Scene viewport empty space keeps canvas actions without borrowing the selected member', t => {
	const f = fixture(t, 'tiny', VIEWPORT_MENU_SOURCE, true); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const view = f.input.view.viewport, selection = f.input.view.authoring.selection;
	const x = view.bounds.right - 4, y = view.bounds.bottom - 4;
	assert.ok(view.pick(x, y) === undefined);
	viewportPointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
	viewportPointer(f, x, y, 0, 0, PointerButton.Secondary);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.input.view.authoring.selection === selection);
	const rows = f.editor.contextMenu.model.rows;
	assert.ok(rows.some(row => row.command === 'sceneEditor.addMember' && row.enabled));
	assert.ok(rows.some(row => row.command === 'sceneViewport.frameAll' && row.enabled));
	assert.equal(rows.some(row => row.command === 'sceneEditor.removeMember' || row.command === 'editor.source'), false);
	assert.equal(f.model.canUndo, false);
});

test('Scene viewport member removal and keyboard Undo share the canonical source and visual projection', t => {
	const f = fixture(t, 'tiny', VIEWPORT_MENU_SOURCE, true); selectSceneOutlineRow(f.input.view.hierarchy, 2); f.update();
	const view = f.input.view.viewport, { x, y } = viewportVisualPoint(f);
	viewportPointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
	viewportPointer(f, x, y, 0, 0, PointerButton.Secondary);
	accept(f, 'sceneEditor.removeMember'); f.update();
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.model.buffer.getText(), VIEWPORT_MENU_SOURCE.replace("{member_id='left',definition_id='tile',position={x=0,y=0}},", ''),
		'only the clicked member is removed; the other member and surrounding source are preserved');
	assert.equal(view.canvas.items.length, 1); assert.equal(f.model.canUndo, true);
	f.pane.focus(); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(f.model.buffer.getText(), VIEWPORT_MENU_SOURCE); assert.equal(view.canvas.items.length, 2);
	assert.equal(f.model.canUndo, false);
});

for (const invalidation of ['selection', 'source', 'attachment'] as const)
	test(`Scene viewport member menu retires when its ${invalidation} changes`, t => {
		const f = fixture(t, 'tiny', VIEWPORT_MENU_SOURCE, true), { x, y } = viewportVisualPoint(f);
		viewportPointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
		viewportPointer(f, x, y, 0, 0, PointerButton.Secondary);
		assert.equal(f.editor.contextMenu.visible, true);
		if (invalidation === 'selection') selectSceneOutlineRow(f.input.view.hierarchy, 2);
		else if (invalidation === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
		else f.pane.control.setView(f.input.view.viewport, f.input.view.viewport.bounds);
		assert.equal(f.editor.contextMenu.visible, false);
	});

for (const invalidation of ['selection', 'source', 'attachment'] as const)
	test(`Scene viewport context click cannot publish a menu after reentrant ${invalidation} replacement`, t => {
		const f = fixture(t, 'tiny', VIEWPORT_MENU_SOURCE, true), view = f.input.view.viewport;
		selectSceneOutlineRow(f.input.view.hierarchy, 2); f.update();
		const { x, y } = viewportVisualPoint(f);
		viewportPointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
		let changed = false;
		const release = f.input.view.authoring.onDidChangeSelection(() => {
			release(); changed = true;
			if (invalidation === 'selection') selectSceneOutlineRow(f.input.view.hierarchy, 2);
			else if (invalidation === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
			else f.pane.control.setView(view, view.bounds);
		});
		t.after(release);
		viewportPointer(f, x, y, 0, 0, PointerButton.Secondary);
		assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
		if (invalidation === 'selection') {
			const selection = f.input.view.authoring.selection;
			assert.ok(selection?.kind === 'member' && selection.entry === f.input.view.authoring.subject!.objects[1]);
		}
	});

for (const subject of ['scene', 'dynamic'] as const) test(`document row Source opens the ${subject} occurrence`, async t => {
	const source = SCENE_VIEWPORT_SOURCE.replace('objects = {', 'objects = { make_object(),');
	const f = fixture(t, 'tiny', source); f.firstGroup.model.pin(f.input);
	const document = f.input.view.authoring.document!, scene = document.scenes[0], entry = scene.objects[0];
	assert.equal(entry.kind, 'dynamic');
	const range = subject === 'scene' ? scene.range : document.analysis.chunk.locations.range(entry.field.span);
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	secondary(f, subject === 'scene' ? 0 : 1); accept(f, 'editor.source');
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const group = f.firstPart.groups.find(candidate => candidate !== f.firstGroup)!;
	const input = group.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.equal(input.context.view.cursorRow, range.start.line - 1);
	assert.equal(input.context.view.cursorColumn, range.start.column - 1);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});

test('document hierarchy row menu contains only member actions with one reparent operation', t => {
	const f = fixture(t); secondary(f, 1);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), [
		'editor.source', 'sceneEditor.inspectLive', 'sceneEditor.renameMember', 'sceneEditor.reparentMember', 'sceneEditor.removeMember', 'sceneEditor.removeSubtree',
	], 'the row does not own Add, panel chrome, section switches or a second reparent variant');
	assert.equal(f.input.view.hierarchy.outline.selectionIndex, 1);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(f.model.canUndo, false);
});

for (const route of ['pointer', 'keyboard'] as const) test(`document hierarchy ${route} menu follows the selected scene or member`, t => {
	const f = fixture(t);
	if (route === 'pointer') secondary(f, 0);
	else { f.key('Home'); f.key('ContextMenu'); }
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.input.view.authoring.selection?.kind, 'scene');
	assert.deepEqual(f.editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), ['editor.source', 'sceneEditor.inspectLive']);
	// A new subject retires the menu instead of reusing an earlier row's authority.
	assert.equal(selectSceneOutlineRow(f.input.view.hierarchy, 1), true);
	assert.equal(f.editor.contextMenu.visible, false);
	if (route === 'pointer') secondary(f, 1);
	else { f.primary.hierarchy.control.focus(); f.key('ContextMenu'); }
	assert.equal(f.input.view.authoring.selection?.kind, 'member');
	const rows = f.editor.contextMenu.model.rows;
	assert.ok(rows.some(row => row.command === 'editor.source'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.renameMember'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.reparentMember'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.removeMember'));
	assert.ok(rows.some(row => row.command === 'sceneEditor.removeSubtree'));
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(f.model.canUndo, false);
});

for (const section of ['outline', 'details'] as const) for (const route of ['overflow', 'secondary'] as const)
	test(`document Scene ${section} header ${route} cannot borrow the selected member menu`, t => {
		const f = fixture(t), panel = section === 'outline' ? f.primary.hierarchy : f.primary.details;
		selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
		const selection = f.input.view.authoring.selection, bar = panel.actionBar;
		assert.equal(bar.focusTarget.focus(), true); f.key('End');
		assert.equal(bar.tooltipItem?.command, WORKBENCH_ACTION_BAR_OVERFLOW);
		if (route === 'overflow') f.key('Enter');
		else {
			const bounds = bar.tooltipItem.bounds;
			const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
			for (const down of [true, false]) f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y,
				buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
				releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0,
				modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		}
		assert.equal(f.editor.contextMenu.visible, true);
		assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'editor.source'
			|| row.command === 'sceneEditor.renameMember' || row.command === 'sceneEditor.reparentMember'
			|| row.command === 'sceneEditor.reparentMemberKeepLocal' || row.command === 'sceneEditor.removeMember'
			|| row.command === 'sceneEditor.removeSubtree'), false);
		assert.equal(f.input.view.authoring.selection, selection);
		assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(f.model.canUndo, false);
	});

for (const target of ['definition', 'member'] as const) test(`Scene pointer ${target} resolves its authored occurrence after accepting the departing draft`, t => {
	const f = fixture(t), input = f.input;
	selectSceneOutlineRow(input.view.hierarchy, 1); f.update();
	const field = f.primary.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, '42', true);
	const index = target === 'definition' ? 0 : 2, tree = input.view.hierarchy.outline, incoming = tree.rows[index], layout = tree.layout;
	const x = layout.contentLeft + (incoming.depth + (target === 'definition' ? 0.5 : 1.5)) * layout.indentWidth;
	const y = layout.contentTop + (index - tree.scroll + 0.5) * layout.rowHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11,', 'x = 42,'));
	const selection = input.view.authoring.selection!;
	if (target === 'definition') {
		assert.equal(selection.kind, 'scene');
		assert.equal(input.view.hierarchy.outline.roots[0].collapsed, true, 'draft acceptance cannot swallow the incoming disclosure gesture');
	} else {
		assert.ok(selection.kind === 'member');
		assert.equal(selection.entry, input.view.authoring.document!.scenes[0].objects[1],
			'the click retains its exact mapped member, not the former row index or AST');
	}
	assert.equal(field.pending, false);
});

test('an incoming Scene click cannot replace a newer selection made by its departing draft publication', t => {
	const f = fixture(t), input = f.input;
	selectSceneOutlineRow(input.view.hierarchy, 1); f.update();
	const field = f.primary.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true);
	setFieldText(field.field, '42', true);
	const tree = input.view.hierarchy.outline, incoming = tree.rows[2], layout = tree.layout;
	const x = layout.contentLeft + (incoming.depth + 1.5) * layout.indentWidth;
	const y = layout.contentTop + (2 - tree.scroll + 0.5) * layout.rowHeight;
	const release = f.model.onDidChangeContent(() => {
		release();
		const document = f.editor.sceneEditor.documents.get(f.model);
		assert.equal(input.view.authoring.select(document, f.model.version, { kind: 'scene', scene: document.scenes[0] }), true);
	});
	t.after(release);
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
	f.update();
	assert.equal(input.view.authoring.selection?.kind, 'scene');
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11,', 'x = 42,'));
});

for (const font of ['tiny', 'msx'] as const) test(`${font} Scene secondary selects the exact row without expanding its disclosure or modifying canonical source`, t => {
	const f = fixture(t, font), root = f.input.view.hierarchy.outline.roots[0], initial = root.collapsed, source = f.model.buffer.getText(), version = f.model.version;
	selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update(); secondary(f, 0, true);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.input.view.hierarchy.outline.rows[f.input.view.hierarchy.outline.selectionIndex] === root);
	assert.equal(root.collapsed, initial);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	f.key('Escape'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === f.primary.hierarchy.control.focusTarget);
});

for (const code of ['ContextMenu', 'F10']) test(`Scene ${code} uses the selected authored member and returns to the exact invoking control on cancel`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 2); f.update(); f.primary.hierarchy.control.focus();
	const origin = inputFocus.admittedTarget, selected = f.input.view.hierarchy.outline.rows[2];
	f.key(code, code === 'F10' ? KeyModifier.shift : KeyModifier.none);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.input.view.hierarchy.outline.rows[f.input.view.hierarchy.outline.selectionIndex] === selected);
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.removeMember' && row.enabled));
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === origin); assert.equal(f.model.canUndo, false);
});


for (const command of ['editor.source', 'editor.sourceToSide'] as const) test(`Scene ${command} opens the exact selected canonical source without rewriting it`, async t => {
	const f = fixture(t); f.firstGroup.model.pin(f.input); selectSceneOutlineRow(f.input.view.hierarchy, 2); f.update();
	const expected = f.pane.getSourceLocation!()!, source = f.model.buffer.getText(), version = f.model.version;
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	secondary(f, 2);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'editor.sourceToSide'), false, 'placement variants stay out of the routine tool menu');
	if (command === 'editor.source') accept(f, command);
	else { f.key('Escape'); f.editor.commands.execute(command, f.primary.hierarchy.control.focusTarget); }
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const group = f.firstPart.groups.find(candidate => candidate !== f.firstGroup)!;
	const input = group.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.equal(input.context.view.cursorRow, expected.selection!.row); assert.equal(input.context.view.cursorColumn, expected.selection!.startColumn);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, false);
	if (command === 'editor.sourceToSide') assert.ok(f.firstGroup.model.activeTab === f.input && f.firstGroup.panes.activePane === f.pane);
});

test('Scene Details section command keeps the selected occurrence without opening inspector or field menus', t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	f.editor.commands.execute('sceneEditor.details', f.primary.hierarchy.control.focusTarget);
	const origin = inputFocus.admittedTarget;
	assert.ok(origin !== null && f.primary.details.scope.contains(origin.scope));
	const show = t.mock.method(f.editor.contextMenu, 'show');
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	const field = f.primary.details.control.controls[0].field; field.focusTarget.focus(); const text = field.readText().text;
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === field.focusTarget);
	assert.equal(show.mock.callCount(), 0, 'neither an empty inspector menu nor a text field inherits member commands');
	assert.equal(field.readText().text, text); assert.equal(f.model.canUndo, false);
});

for (const code of ['ContextMenu', 'F10'] as const) test(`Scene Details ${code} leaves a focused field draft untouched`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const control = f.primary.details.control, field = control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '77', true);
	const source = f.model.buffer.getText(), selection = f.input.view.authoring.selection;
	const show = t.mock.method(f.editor.contextMenu, 'show');
	const modifiers = code === 'F10' ? KeyModifier.shift : KeyModifier.none, down = new KeyInputEvent(code, modifiers);
	f.editor.dispatchKey(down); f.editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); f.update();
	assert.equal(down.consumed, false); assert.equal(show.mock.callCount(), 0);
	assert.ok(inputFocus.admittedTarget === field.field.focusTarget); assert.equal(field.pending, true);
	assert.equal(field.field.text, '77'); assert.equal(f.model.buffer.getText(), source);
	assert.ok(f.input.view.authoring.selection === selection); assert.equal(f.model.canUndo, false);
});

test('secondary click on the Details body accepts a focused field draft without opening a menu', t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const control = f.primary.details.control, field = control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '77', true);
	const source = f.model.buffer.getText(), bounds = f.input.view.details.viewport.bounds;
	const show = t.mock.method(f.editor.contextMenu, 'show');
	for (const down of [true, false]) f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x: bounds.left + 1, y: bounds.top + 1,
		buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
		releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
	assert.equal(show.mock.callCount(), 0); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(inputFocus.admittedTarget === control.focusTarget); assert.equal(field.pending, false);
	assert.equal(f.model.buffer.getText(), source.replace('x = 11,', 'x = 77,')); assert.equal(f.model.canUndo, true);
	f.model.undo(); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});

test('Scene menu moves and removes authored members through canonical Undo and Save', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = fixture(t), before = f.model.buffer.getText();
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	secondary(f, 1);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.moveMemberUp' || row.command === 'sceneEditor.moveMemberDown'), false,
		'reordering is a direct hierarchy gesture, not duplicate routine menu entries');
	f.key('Escape'); f.editor.commands.execute('sceneEditor.moveMemberDown', f.primary.hierarchy.control.focusTarget);
	const moved = f.model.buffer.getText(); assert.ok(moved !== before); assert.equal(f.model.canUndo, true);
	assert.ok(moved.indexOf("member_id = 'source only'") < moved.indexOf("member_id = 'subject'"));
	f.editor.commands.execute('undo', f.primary.hierarchy.control.focusTarget); assert.equal(f.model.buffer.getText(), before); f.update();
	secondary(f, 2); accept(f, 'sceneEditor.removeMember');
	const removed = f.model.buffer.getText(); assert.ok(removed !== before && !removed.includes("member_id = 'source only'"));
	assert.equal(f.input.view.hierarchy.outline.selectionIndex, -1); assert.equal(f.model.canUndo, true);
	f.editor.commands.execute('save', f.primary.hierarchy.control.focusTarget);
	const operation = f.ide.textFileSaves.latestOperation(f.model); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved'); assert.equal(f.model.dirty, false); assert.equal(f.model.canUndo, true);
	assert.ok([...files.records.values()].some(record => record.contents === removed));
	f.editor.commands.execute('undo', f.primary.hierarchy.control.focusTarget); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.dirty, true);
});

for (const invalidation of ['selection', 'source', 'equal-source', 'attachment'] as const) test(`Scene menu is revoked by actual ${invalidation} retirement`, t => {
	const f = fixture(t), before = f.model.buffer.getText(); secondary(f, 1); assert.equal(f.editor.contextMenu.visible, true);
	if (invalidation === 'selection') selectSceneOutlineRow(f.input.view.hierarchy, 2);
	else if (invalidation === 'attachment') f.firstGroup.openEditor(new HostErrorInput('replacement'));
	else f.model.pushEditOperations([{ offset: 0, deleteLength: invalidation === 'equal-source' ? before.length : 0,
		text: invalidation === 'equal-source' ? before : '-- source publication\n' }]);
	assert.equal(f.editor.contextMenu.visible, false);
	const current = f.model.buffer.getText(); f.key('Enter'); assert.equal(f.model.buffer.getText(), current);
});

test('Scene menu cannot retarget an accepted remove when focus return selects another occurrence', t => {
	const f = fixture(t), before = f.model.buffer.getText(); secondary(f, 1);
	const origin = f.editor.contextMenu.returnFocus!; let changed = false;
	const unbind = origin.onDidFocus(() => { unbind(); changed = true; selectSceneOutlineRow(f.input.view.hierarchy, 2); }); t.after(unbind);
	accept(f, 'sceneEditor.removeMember'); assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.input.view.hierarchy.outline.selectionIndex, 2); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});

for (const change of ['foreign', 'rebind', 'reattach'] as const) test(`Scene physical secondary consumes its old row after ${change} focus callback`, t => {
	const f = fixture(t), before = f.model.buffer.getText(); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update(); f.second.focus();
	let changed = false; const origin = f.primary.hierarchy.control.focusTarget;
	const unbind = origin.onDidFocus(() => {
		unbind(); changed = true;
		if (change === 'foreign') f.second.focus();
		else { f.firstGroup.openEditor(new HostErrorInput('replacement')); if (change === 'reattach') f.firstGroup.openEditor(f.input); }
	}); t.after(unbind);
	secondary(f, 2); assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.input.view.hierarchy.outline.selectionIndex, 1); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
	if (change === 'foreign') assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('Scene selection publication describes coherent source bindings and ignores passive refresh or reselection', t => {
	const f = fixture(t); let changed = 0;
	t.after(f.input.view.authoring.onDidChangeSelection(() => {
		changed++; const selection = f.input.view.authoring.selection!;
		assert.ok(selection.kind === 'member');
		const range = f.input.view.authoring.document!.analysis.chunk.locations.range(selection.entry.field.span);
		const start = f.model.buffer.offsetAt(range.start.line - 1, range.start.column - 1);
		assert.equal(f.input.view.authoring.selectionRange.start, start);
	}));
	selectSceneOutlineRow(f.input.view.hierarchy, 1); assert.equal(changed, 1);
	assert.equal(f.input.view.details.properties[0].descriptor.value, 11);
	f.update(); selectSceneOutlineRow(f.input.view.hierarchy, 1); assert.equal(changed, 1);
});

test('Scene secondary does not overwrite a newer selection made by its publication listener', t => {
	const f = fixture(t), before = f.model.buffer.getText();
	const unbind = f.input.view.authoring.onDidChangeSelection(() => { unbind(); selectSceneOutlineRow(f.input.view.hierarchy, 2); }); t.after(unbind);
	secondary(f, 1); assert.equal(f.input.view.hierarchy.outline.selectionIndex, 2); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});


test('Scene menu retains its exact model mutation without stealing a newer foreign return focus', t => {
	const f = fixture(t), source = f.model.buffer.getText(), foreign = f.secondInput.workingCopy.buffer.getText(); secondary(f, 1);
	const origin = f.editor.contextMenu.returnFocus!; let changed = false;
	const unbind = origin.onDidFocus(() => { unbind(); changed = true; f.second.focus(); }); t.after(unbind);
	accept(f, 'sceneEditor.removeMember'); assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(f.model.buffer.getText() !== source && !f.model.buffer.getText().includes("member_id = 'subject'"));
	assert.equal(f.model.canUndo, true); assert.equal(f.secondInput.workingCopy.buffer.getText(), foreign);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	f.editor.commands.execute('undo', f.primary.hierarchy.control.focusTarget); assert.equal(f.model.buffer.getText(), source);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
});

test('Scene secondary consumes selection publication that establishes a newer foreign control', t => {
	const f = fixture(t), before = f.model.buffer.getText();
	const unbind = f.input.view.authoring.onDidChangeSelection(() => { unbind(); f.second.focus(); }); t.after(unbind);
	secondary(f, 1); assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.input.view.hierarchy.outline.selectionIndex, 1);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});


for (const rebind of [false, true]) test(`Scene retained member command ${rebind ? 'rejects a draft publication that rebinds its attachment' : 'settles its actual focused draft before canonical mutation'}`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const commandTarget = f.primary.hierarchy.control.focusTarget; f.editor.commands.execute('sceneEditor.details', commandTarget);
	const field = f.primary.details.control.controls[0].field; field.focusTarget.focus();
	assert.equal(field.replaceText(0, field.readText().text.length, '77'), true); assert.equal(field.focusTarget.edit!.pending, true);
	let rebound = false;
	if (rebind) {
		const unbind = f.model.onDidChangeContent(() => { unbind(); rebound = true; f.firstGroup.openEditor(new HostErrorInput('newer attachment')); }); t.after(unbind);
	}
	f.editor.commands.execute('sceneEditor.moveMemberDown', commandTarget);
	const text = f.model.buffer.getText(); assert.equal(field.focusTarget.edit!.pending, false); assert.ok(text.includes('x = 77,'));
	assert.equal(rebound, rebind); assert.equal(f.model.canUndo, true);
	assert.equal(text.indexOf("member_id = 'source only'") < text.indexOf("member_id = 'subject'"), !rebind);
	if (rebind) assert.ok(f.firstGroup.model.activeTab instanceof HostErrorInput);
});

for (const route of ['pointer', 'ContextMenu', 'F10'] as const) test(`document Scene Details ${route} does not offer a body context menu`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	f.editor.commands.execute('sceneEditor.details', f.primary.hierarchy.control.focusTarget);
	const origin = inputFocus.admittedTarget, before = f.model.buffer.getText(), bounds = f.input.view.details.viewport.bounds;
	const show = t.mock.method(f.editor.contextMenu, 'show');
	if (route === 'pointer') for (const down of [true, false]) f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x: bounds.left + 1, y: bounds.top + 1,
		buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
		releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	else {
		const modifiers = route === 'F10' ? KeyModifier.shift : KeyModifier.none;
		const down = new KeyInputEvent(route, modifiers);
		f.editor.dispatchKey(down); f.editor.dispatchKey(new KeyInputEvent(route, modifiers, false, false)); f.update();
		assert.equal(down.consumed, false, 'an absent menu does not claim its context-menu shortcut');
	}
	assert.equal(show.mock.callCount(), 0, 'the inspector does not request a popup');
	assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	assert.equal(f.input.view.hierarchy.outline.selectionIndex, 1); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});

for (const operation of ['update', 'setOptions'] as const) test(`Scene ${operation} source rebuild stops its retired pane when selection publication opens another editor`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const navigation = f.pane.getSelection(); t.after(() => navigation.dispose());
	const selected = f.input.view.hierarchy.outline.rows[f.input.view.hierarchy.outline.selectionIndex].element;
	assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	const replacement = new HostErrorInput('replacement'); let publications = 0;
	const unbind = f.input.view.authoring.onDidChangeSelection(() => {
		unbind(); publications++;
		f.firstGroup.openEditor(replacement);
	}); t.after(unbind);
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, f.input.view.authoring.document!.analysis.chunk.locations, f.input.view.authoring.document!.analysis.chunk.tokens, selected.entry.field));
	const edited = f.model.buffer.getText();
	assert.doesNotThrow(() => {
		if (operation === 'setOptions') f.pane.setOptions(undefined, navigation);
		else f.pane.update();
	});
	assert.equal(publications, 1); assert.ok(f.firstGroup.model.activeTab === replacement);
	assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane?.commandTarget);
	assert.equal(f.model.buffer.getText(), edited); assert.equal(f.model.canUndo, true);
});

test('Scene history capture observes a retired semantic selection without further publication', t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const context = f.input.view.authoring, document = context.document!;
	const selected = f.input.view.hierarchy.outline.rows[f.input.view.hierarchy.outline.selectionIndex].element;
	assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	let publications = 0;
	t.after(context.onDidChangeSelection(() => { publications++; }));
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, document.analysis.chunk.locations, document.analysis.chunk.tokens, selected.entry.field));
	const edited = f.model.buffer.getText(), focused = inputFocus.admittedTarget;
	assert.equal(publications, 1); assert.equal(context.hasSelection, false);
	const snapshot = f.pane.getSelection(); t.after(() => snapshot.dispose());
	assert.equal(snapshot.snapshot.selected, undefined, 'a collapsed tracked occurrence has no bookmarked selection');
	assert.equal(publications, 1, 'capturing history does not publish another selection');
	const retainedInput = f.firstGroup.model.activeTab;
	assert.ok(retainedInput === f.input && f.firstGroup.panes.activePane === f.pane);
	assert.ok(inputFocus.admittedTarget === focused);
	f.pane.update();
	assert.equal(publications, 1);
	assert.ok(f.firstGroup.model.activeTab === f.input);
	assert.equal(f.model.buffer.getText(), edited);
});

test('Scene history restore stops its retired pane when the restored selection opens another editor', t => {
	const f = fixture(t), source = f.model.buffer.getText(); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	const navigation = f.pane.getSelection(); t.after(() => navigation.dispose());
	selectSceneOutlineRow(f.input.view.hierarchy, 2); f.update();
	const replacement = new HostErrorInput('replacement'); let publications = 0;
	const unbind = f.input.view.authoring.onDidChangeSelection(() => {
		unbind(); publications++; f.firstGroup.openEditor(replacement);
	}); t.after(unbind);
	assert.doesNotThrow(() => f.pane.setOptions(undefined, navigation));
	assert.equal(publications, 1); assert.ok(f.firstGroup.model.activeTab === replacement);
	assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane?.commandTarget);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});

for (const font of ['tiny', 'msx'] as const)
test(`${font} Scene numeric fields retain companion commands and accept their exact draft before leaving Details`, t => {
	const f = fixture(t, font);
	selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	f.editor.commands.execute('sceneEditor.details', f.primary.hierarchy.control.focusTarget);
	const field = f.primary.details.control.controls[0].field;
	assert.equal(field.focusTarget.focus(), true);
	assert.ok(field.focusTarget.getCommand('sceneEditor.details')?.isEnabled());
	assert.ok(field.focusTarget.getCommand('sceneEditor.outline')?.isEnabled());
	const source = f.model.buffer.getText();
	const selected = f.input.view.authoring.selection!;
	assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	const range = luaSourceRangeToTextRange(f.model.buffer, f.input.view.authoring.document.analysis.chunk.locations.range((selected.entry.position!.value as LuaTableConstructorExpression).fields[0].value.span));
	setFieldText(field, '42', true); assert.equal(f.model.buffer.getText(), source);
	f.editor.commands.execute('sceneEditor.outline');
	assert.ok(inputFocus.admittedTarget !== null && f.primary.hierarchy.scope.contains(inputFocus.admittedTarget.scope));
	// Exact source is the data-integrity contract of accepting this concrete numeric draft.
	assert.equal(f.model.buffer.getText(), source.slice(0, range.start) + '42' + source.slice(range.end));
});

test('an invalid numeric draft blocks Scene section navigation without publishing a view or source change', t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	f.editor.commands.execute('sceneEditor.details', f.primary.hierarchy.control.focusTarget);
	const field = f.primary.details.control.controls[0].field; field.focusTarget.focus();
	const source = f.model.buffer.getText(), version = f.model.version;
	setFieldText(field, 'not an integer', true);
	f.editor.commands.execute('sceneEditor.outline');
	assert.ok(inputFocus.admittedTarget === field.focusTarget);
	assert.equal(field.text, 'not an integer'); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
});

test('Scene section presentation cannot overwrite newer foreign focus established by the departing field', t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	f.editor.commands.execute('sceneEditor.details', f.primary.hierarchy.control.focusTarget);
	const field = f.primary.details.control.controls[0].field; field.focusTarget.focus();
	const source = f.model.buffer.getText(), version = f.model.version;
	const unbind = field.focusTarget.onDidBlur(() => { unbind(); f.second.focus(); }); t.after(unbind);
	f.editor.commands.execute('sceneEditor.outline');
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
});

test('Scene section navigation accepts its exact draft without overwriting foreign focus established by source publication', t => {
	const f = fixture(t); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	f.editor.commands.execute('sceneEditor.details', f.primary.hierarchy.control.focusTarget);
	const field = f.primary.details.control.controls[0].field;
	assert.equal(field.focusTarget.focus(), true);
	const source = f.model.buffer.getText();
	const selected = f.input.view.authoring.selection!;
	assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	const range = luaSourceRangeToTextRange(f.model.buffer, f.input.view.authoring.document.analysis.chunk.locations.range((selected.entry.position!.value as LuaTableConstructorExpression).fields[0].value.span));
	setFieldText(field, '42', true);
	let publications = 0;
	const unbind = f.model.onDidChangeContent(() => { unbind(); publications++; f.second.focus(); }); t.after(unbind);
	f.editor.commands.execute('sceneEditor.outline');
	// Exact source is the data-integrity contract of the accepted numeric draft.
	assert.equal(f.model.buffer.getText(), source.slice(0, range.start) + '42' + source.slice(range.end));
	assert.equal(field.focusTarget.edit!.pending, false); assert.equal(f.model.canUndo, true);
	assert.equal(publications, 1);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} Scene row menu excludes section-switch commands while companions retain focus navigation`, t => {
	const f = fixture(t, font); selectSceneOutlineRow(f.input.view.hierarchy, 1); f.update();
	assert.equal(f.primary.hierarchy.attached, true); assert.equal(f.primary.details.attached, true);
	secondary(f, 1);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.details' || row.command === 'sceneEditor.outline'), false);
	f.key('Escape'); f.key('Enter');
	assert.ok(f.primary.details.scope.contains(inputFocus.admittedTarget!.scope));
	f.editor.commands.execute('sceneEditor.outline');
	assert.ok(f.primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.model.canUndo, false);
});
