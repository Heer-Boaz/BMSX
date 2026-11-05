import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { WorkbenchTooltip } from '../../ide/workbench/ui/tooltip';
import { captureSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { CARTLIB_OBJECT_SOURCE_MODULES } from '../fixtures/studio/cartlib_objects';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('room',{objects={
 {member_id='root',definition_id='node2',position={x=20,y=30}},
 {member_id='child',definition_id='node2',parent='root',position={x=40,y=10}},
 {member_id='mesh_origin',definition_id='node3',position={x=4,y=8,z=12}},
}})`;
const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d')})`;

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [...CARTLIB_OBJECT_SOURCE_MODULES, ['scene.lua', SOURCE], ['prefabs.lua', PREFABS],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/world/prefab.lua', 'return { define=function() end }']]);
	f.editor.setFontVariant(font); f.first.focus();
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model), main = f.editor.mainWorkspace;
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.update();
	const client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	const group = f.editor.editorParts.findGroup(client.input); assert.ok(group !== undefined);
	const pane = group.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	assert.equal(client.authoring.availability, 'available'); assert.equal(client.view.viewport.source!.entries.length, 3);
	return { ...f, main, client, model, group, pane, viewport: pane.control };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
/** Coordinates address the actual viewport; assertions check routing and state. */
function pointer(f: Fixture, x: number, y: number, held: number, pressed = 0, released = 0): void {
	f.host.clock.advance(10);
	f.editor.dispatchPointer({ x, y, buttons: held, pressedButtons: pressed, releasedButtons: released,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
}

/** A second editor group is an independently owned visible document, not a fake Scene pin. */
function sourceGroup(f: Fixture, model = f.model) {
	const group = f.editor.editorParts.main.splitGroup(f.group, 'down');
	const input = new CodeEditorInput(model);
	assert.ok(group.openEditor(input)); f.update();
	return { group, input };
}

test('native Scene flight uses host frames while captured, then returns F and keyboard focus to ordinary editing', async t => {
	const f = await fixture(t), view = f.client.view.viewport;
	selectSceneOutlineRow(f.client.view.hierarchy, 2); f.update(); f.main.focusPrimary('viewport');
	f.editor.commands.execute('sceneViewport.view3d', f.viewport.focusTarget); f.update();
	const selected = f.client.authoring.selection, initial = view.camera.capture();
	const x = (view.bounds.left + view.bounds.right) / 2, y = (view.bounds.top + view.bounds.bottom) / 2;
	pointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
	assert.equal(pointerCapture.active, true); assert.equal(f.editor.contextMenu.visible, false);
	const frame = t.mock.method(view, 'frame');
	f.editor.dispatchKey(new KeyInputEvent('KeyF', KeyModifier.none));
	f.update(100);
	assert.notDeepEqual(view.camera.capture(), initial); assert.equal(frame.mock.callCount(), 0, 'RMB+F moves, it does not frame selection');
	pointer(f, x, y, 0, 0, PointerButton.Secondary);
	const released = view.camera.capture(); f.update(100);
	assert.deepEqual(view.camera.capture(), released, 'release stops held-key movement even without a key-up');
	f.editor.dispatchKey(new KeyInputEvent('KeyF', KeyModifier.none, false, false));
	assert.equal(f.editor.contextMenu.visible, false);
	f.key('KeyF'); assert.equal(frame.mock.callCount(), 1, 'outside navigation F again frames the selection');
	pointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary);
	f.editor.dispatchKey(new KeyInputEvent('ArrowUp', KeyModifier.none)); f.update(100);
	const flying = view.camera.capture();
	f.key('Tab'); assert.equal(f.viewport.focusTarget.hasFocus, false); assert.equal(pointerCapture.active, false);
	f.update(100); assert.deepEqual(view.camera.capture(), flying, 'Tab cannot leave a camera flying in the background');
	f.editor.dispatchKey(new KeyInputEvent('ArrowUp', KeyModifier.none, false, false));
	pointer(f, x, y, 0, 0, PointerButton.Secondary);
	assert.ok(f.client.authoring.selection === selected);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const font of ['tiny', 'msx'] as const)
test(`${font} authored Scene is a real document viewport beside independent document groups`, async t => {
	const f = await fixture(t, font), parts = f.editor.editorParts;
	assert.ok(f.group.model.contains(f.client.input));
	assert.ok(f.pane.input === f.client.input && f.viewport.view === f.client.view.viewport);
	assert.ok(f.viewport.focusTarget.hasFocus);
	assert.equal(f.client.preferredPart, 'viewport');
	assert.ok(f.client.view.viewport.authoring === f.client.authoring);
	const source = sourceGroup(f); source.group.focus('content');
	assert.ok(f.main.primary === f.client && f.group.panes.activePane === f.pane);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	f.main.focusPrimary('viewport'); assert.ok(f.viewport.focusTarget.hasFocus);
	f.key('F6'); assert.ok(inputFocus.admittedTarget !== null && parts.main.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(source.group.model.activeTab === source.input && f.main.primary === f.client);
	assert.equal(f.model.canUndo, false);
});

test('Source from the viewport keeps its exact authored selection and opens beside the Scene document', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main;
	selectSceneOutlineRow(f.client.view.hierarchy, 2); f.update(); f.main.focusPrimary('viewport');
	const selection = f.client.authoring.selection, camera = f.client.view.viewport.camera.capture();
	const target = f.viewport.focusTarget, opening = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', target);
	assert.equal(opening.mock.callCount(), 1); assert.ok(await opening.mock.calls[0].result !== undefined); f.update();
	const sourceGroup = part.activeGroup, input = sourceGroup.model.activeTab;
	assert.ok(sourceGroup !== f.group && input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.ok(sourceGroup.focusScope.contains(inputFocus.admittedTarget!.scope));
	assert.ok(f.main.primary === f.client && f.client.authoring.selection === selection);
	assert.ok(f.group.panes.activePane === f.pane && f.pane.input === f.client.input);
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera); assert.equal(f.model.canUndo, false);
});

test('a preserve-focus neighboring document cannot replace Scene focus or its retained input', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, group = part.splitGroup(f.group, 'down');
	f.main.focusPrimary('viewport'); const origin = inputFocus.admittedTarget;
	group.openEditor(new CodeEditorInput(f.model), { preserveFocus: true }); f.update();
	assert.ok(inputFocus.admittedTarget === origin && f.main.primary === f.client);
	assert.ok(f.group.panes.activePane === f.pane && f.pane.input === f.client.input);
});

for (const control of ['content', 'tabs'] as const)
test(`closing a focused neighboring ${control} leaves the Scene document and camera intact`, async t => {
	const f = await fixture(t), source = sourceGroup(f); source.group.focus(control);
	const camera = f.client.view.viewport.camera.capture();
	assert.equal(await source.group.close(source.input.id), true); f.update();
	assert.ok(f.group.model.contains(f.client.input) && f.group.panes.activePane === f.pane);
	f.main.focusPrimary('viewport'); assert.ok(f.viewport.focusTarget.hasFocus);
	f.key('F6'); assert.ok(f.client.details.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6', KeyModifier.shift); assert.ok(f.viewport.focusTarget.hasFocus);
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera); assert.equal(f.model.canUndo, false);
});

test('bulk closing neighboring documents cannot retire the Scene or its shared working copy', async t => {
	const f = await fixture(t), parts = f.editor.editorParts, part = parts.main;
	const first = sourceGroup(f), second = part.splitGroup(first.group, 'down'), secondInput = new CodeEditorInput(f.model);
	second.openEditor(secondInput); f.update(); first.group.focus();
	assert.equal(await parts.closeController.close([{ group: first.group, input: first.input }, { group: second, input: secondInput }], inputFocus.target, part.actionPrompt), true);
	f.update(); assert.ok(part.groups.includes(first.group) && part.groups.includes(second));
	assert.ok(f.group.model.contains(f.client.input) && f.group.panes.activePane === f.pane && f.main.primary === f.client);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('group retirement cannot replace a newer focus-and-null request from disposal', async t => {
	const f = await fixture(t), parts = f.editor.editorParts, part = parts.main, source = sourceGroup(f);
	const sibling = part.splitGroup(source.group, 'down'); sibling.openEditor(new CodeEditorInput(f.model)); f.update(); source.group.focus();
	t.after(source.group.onWillDispose(() => { f.second.focus(); inputFocus.setTarget(null); }));
	assert.equal(await parts.closeGroup(source.group), true); f.update();
	assert.equal(inputFocus.target, null); assert.ok(part.groups.includes(sibling));
	assert.ok(f.group.model.contains(f.client.input));
});

test('a preserve-focus opening during clear revokes the old close receipt before a later background close', async t => {
	const f = await fixture(t), source = sourceGroup(f), incoming = new CodeEditorInput(f.firstInput.workingCopy);
	let unbind: () => void;
	unbind = source.group.panes.onDidClearEditor(() => { unbind(); source.group.openEditor(incoming, { pinned: true, preserveFocus: true }); }); t.after(unbind);
	assert.equal(await source.group.close(source.input.id), true); f.update();
	assert.ok(source.group.model.activeTab === incoming); assert.equal(inputFocus.target, null);
	assert.equal(await source.group.close(incoming.id), true); f.update();
	assert.equal(inputFocus.target, null); assert.ok(f.group.model.contains(f.client.input));
});

test('withdrawing the game companion cannot replace a newer focus-and-null request from blur', async t => {
	const f = await fixture(t), source = sourceGroup(f), game = f.editor.gamePanel;
	f.editor.updateViewport({ width: 1200, height: 800 }); game.toggle(); f.update();
	assert.equal(game.visible, true);
	const bounds = f.editor.editorParts.mainArea.companionBounds;
	pointer(f, bounds.left + 4, bounds.top + 4, PointerButton.Primary, PointerButton.Primary);
	pointer(f, bounds.left + 4, bounds.top + 4, 0, 0, PointerButton.Primary);
	const target = inputFocus.admittedTarget!; assert.ok(game.focusScope.contains(target.scope));
	t.after(target.onDidBlur(() => { f.second.focus(); inputFocus.setTarget(null); }));
	game.close(); f.update();
	assert.equal(game.visible, false); assert.equal(inputFocus.target, null);
	assert.ok(source.group.model.activeTab === source.input && f.main.primary === f.client);
});

for (const redirect of ['background', 'new focus', 'new focus then null'] as const)
test(`closing a neighboring Source document preserves ${redirect}`, async t => {
	const f = await fixture(t), source = sourceGroup(f);
	if (redirect === 'background') f.second.focus();
	else {
		let unbind: () => void;
		unbind = source.group.panes.onDidClearEditor(() => { unbind(); f.second.focus(); if (redirect === 'new focus then null') inputFocus.setTarget(null); });
		t.after(unbind);
	}
	assert.equal(await source.group.close(source.input.id), true); f.update();
	if (redirect === 'new focus then null') assert.equal(inputFocus.target, null);
	else assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.group.model.contains(f.client.input));
});

test('local modals return to the Scene viewport without replacing its document', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, origin = f.viewport.focusTarget;
	part.quickInput.input('', '', '', async value => value, undefined, undefined, { invocationOrigin: origin }); f.update();
	assert.equal(part.quickInput.visible, true); assert.ok(inputFocus.admittedTarget === part.quickInput.field.focusTarget);
	f.key('Escape'); assert.equal(part.quickInput.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	const decision = part.actionPrompt.show({ title: 'Pending action', message: 'Continue?', primary: 'Continue', secondary: 'Cancel', primaryEnabled: true, defaultChoice: 'cancel' }, origin); f.update();
	assert.equal(part.actionPrompt.visible, true); part.actionPrompt.focusTarget.focus();
	assert.ok(part.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('Escape'); assert.equal(await decision, 'cancel'); assert.ok(inputFocus.admittedTarget === origin);
	assert.ok(f.group.panes.activePane === f.pane && f.pane.input === f.client.input);
});

for (const route of ['keyboard', 'pointer'] as const)
test(`the viewport ${route} context menu addresses its camera and returns to the same canvas`, async t => {
	const f = await fixture(t), origin = f.viewport.focusTarget;
	selectSceneOutlineRow(f.client.view.hierarchy, 2); f.update(); f.main.focusPrimary('viewport');
	const selected = f.client.authoring.selection;
	if (route === 'keyboard') f.key('ContextMenu');
	else {
		const bounds = f.client.view.viewport.bounds, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
		pointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary); pointer(f, x, y, 0, 0, PointerButton.Secondary);
	}
	const menu = f.editor.contextMenu;
	assert.equal(menu.visible, true); assert.ok(menu.returnFocus === origin);
	assert.ok(menu.model.rows.some(row => row.command === 'sceneViewport.frameAll' && row.enabled));
	assert.equal(menu.model.rows.some(row => row.command === 'editor.source'), false);
	f.key('Home');
	for (let step = 0; menu.model.rows[menu.model.selectedIndex]?.command !== 'sceneViewport.frameAll' && step < menu.model.rows.length; step++) f.key('ArrowDown');
	assert.equal(menu.model.rows[menu.model.selectedIndex].command, 'sceneViewport.frameAll'); f.key('Enter');
	assert.equal(menu.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	assert.ok(f.client.authoring.selection === selected);
	f.key('Escape'); assert.ok(f.client.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.model.canUndo, false);
});

test('viewport feedback follows hovered or keyboard-focused actions, not ordinary canvas focus', async t => {
	const f = await fixture(t), view = f.client.view.viewport;
	const caption = t.mock.method(view.caption, 'draw');
	const tooltip = t.mock.method(WorkbenchTooltip.prototype, 'show');
	const navigation = view.navigationActions.items.find(item => item.command === 'sceneViewport.navigationOptions')!;
	// Feedback must carry the same retained action target as the actual pointer
	// route; no particular wording or pixel placement is part of this contract.
	const navigationHints = () => tooltip.mock.calls.filter(call => call.arguments[1] === navigation.bounds).length;
	f.main.focusPrimary('viewport'); f.paint();
	assert.equal(caption.mock.callCount(), 0);
	assert.equal(navigationHints(), 0);
	pointer(f, (navigation.bounds.left + navigation.bounds.right) / 2, (navigation.bounds.top + navigation.bounds.bottom) / 2, 0);
	f.paint();
	assert.ok(navigationHints() > 0);
	const count = navigationHints();
	pointer(f, view.bounds.right - 2, view.bounds.bottom - 2, 0); f.paint();
	assert.equal(navigationHints(), count, 'moving back into content withdraws the action feedback');
	f.key('Tab', KeyModifier.shift); f.key('Home'); f.paint();
	assert.ok(f.viewport.tooltipItem === view.navigationActions.items[0]);
	f.key('Enter');
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.viewport.tooltipItem, undefined, 'a menu owns interaction instead of leaving its trigger tooltip active');
	f.key('ArrowDown'); f.key('Enter'); f.paint();
	assert.equal(view.camera.mode, '3d');
	assert.ok(inputFocus.admittedTarget === f.viewport.focusTarget);
	assert.equal(caption.mock.callCount(), 0, 'returning from the view menu must not restore the permanent help box');
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	f.group.openEditor(f.firstInput); f.paint();
	assert.equal(navigationHints(), count, 'retired document feedback cannot outlive its viewport');
});

test('camera movement remains document reading state and allocation change cancels only its capture', async t => {
	const f = await fixture(t), bounds = f.client.view.viewport.bounds;
	const before = f.client.view.viewport.camera.capture(), selection = f.client.authoring.selection;
	const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	pointer(f, x, y, PointerButton.Auxiliary, PointerButton.Auxiliary); assert.equal(pointerCapture.active, true);
	pointer(f, x + 18, y + 9, PointerButton.Auxiliary);
	const moved = f.client.view.viewport.camera.capture(); assert.notDeepEqual(moved, before);
	f.editor.updateViewport({ width: 1200, height: 800 }); f.update();
	assert.equal(pointerCapture.active, false); assert.ok(f.group.panes.activePane === f.pane);
	assert.deepEqual(f.client.view.viewport.camera.capture(), moved);
	pointer(f, x + 35, y + 24, 0, 0, PointerButton.Auxiliary);
	assert.deepEqual(f.client.view.viewport.camera.capture(), moved);
	assert.ok(f.client.authoring.selection === selection);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('suspending companions preserves the document viewport, camera and source subject', async t => {
	const f = await fixture(t);
	f.editor.commands.execute('sceneViewport.view3d', f.pane.commandTarget); f.update();
	const camera = f.client.view.viewport.camera.capture(), input = f.client.input;
	f.main.suspend();
	assert.equal(f.client.hierarchy.attached, false); assert.equal(f.client.details.attached, false);
	assert.equal(pointerCapture.active, false); assert.ok(f.group.model.contains(input));
	f.main.resume(); f.update(); f.main.focusPrimary('viewport');
	assert.ok(f.main.primary === f.client && f.group.panes.activePane === f.pane);
	assert.ok(f.viewport.focusTarget.hasFocus); assert.deepEqual(f.client.view.viewport.camera.capture(), camera);
	assert.equal(f.model.canUndo, false);
});

test('the Scene document snapshot retains camera and focus independently of companion layout', async t => {
	const f = await fixture(t);
	f.editor.commands.execute('sceneViewport.view3d', f.pane.commandTarget); f.update(); f.main.focusPrimary('viewport');
	const camera = f.client.view.viewport.camera.capture(), source = captureSceneEditorView(f.client.view);
	assert.deepEqual(source.camera, camera); assert.equal(source.preferredPart, 'viewport');
	f.main.resetLayout(); f.update();
	assert.ok(f.main.primary === f.client && f.group.panes.activePane === f.pane);
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera); assert.equal(f.model.canUndo, false);
});

test('companion retirement during viewport allocation cannot reattach regions or steal newer focus', async t => {
	const f = await fixture(t);
	const layout = t.mock.method(f.viewport, 'layout', () => { layout.mock.restore(); f.main.reset(); f.second.focus(); });
	assert.doesNotThrow(() => { f.editor.updateViewport({ width: 1200, height: 800 }); f.update(); });
	assert.equal(layout.mock.callCount(), 1); assert.equal(f.main.primary, undefined);
	assert.equal(f.client.hierarchy.attached, false); assert.equal(f.client.details.attached, false);
	assert.ok(f.group.panes.activePane === f.pane && inputFocus.admittedTarget === f.second.commandTarget);
	assert.equal(f.model.canUndo, false);
});
