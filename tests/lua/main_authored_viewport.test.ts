import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { captureScenePrimary } from '../../ide/workbench/contrib/scene_editor/primary_snapshot';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('room',{objects={
 {member_id='root',definition_id='node2',spatial={local_transform={1,0,0,1,20,30}}},
 {member_id='child',definition_id='node2',spatial={parent_id='root',local_transform={1,0,0,1,40,10}}},
 {member_id='mesh_origin',definition_id='node3',spatial={local_transform={1,0,0,0,1,0,0,0,1,4,8,12}}},
}})`;
const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class={},spatial={family='2d',authority='affine'}})
prefab.define({def_id='node3',class={},spatial={family='3d',authority='affine'}})`;

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['prefabs.lua', PREFABS],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/world/prefab.lua', 'return { define=function() end }']]);
	f.editor.setFontVariant(font); f.first.focus();
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model), main = f.editor.mainWorkspace;
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.update(); const client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	return { ...f, main, client, model };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
/** Physical coordinates only locate the actual viewport; assertions verify routing and retained ownership. */
function pointer(f: Fixture, x: number, y: number, held: number, pressed = 0, released = 0): void {
	f.host.clock.advance(10);
	f.editor.dispatchPointer({ x, y, buttons: held, pressedButtons: pressed, releasedButtons: released,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
}

for (const font of ['tiny', 'msx'] as const)
test(`${font} authored content is a real independently focused Main client beside unchanged document groups`, async t => {
	const f = await fixture(t, font), viewport = f.client.viewport, parts = f.editor.editorParts;
	assert.equal(viewport.attached, true);
	assert.ok(viewport.control.focusTarget.hasFocus);
	assert.equal(f.client.preferredPart, 'viewport');
	assert.ok(f.client.view.viewport.authoring === f.client.consumer);
	assert.ok(parts.main.groups.every(group => group.model.tabs.every(input => input.kind !== 'scene_editor')));
	const source = new CodeEditorInput(f.model), group = parts.main.activeGroup;
	group.openEditor(source); f.update(); group.panes.activePane!.focus();
	assert.ok(f.main.primary === f.client && f.client.viewport === viewport && viewport.attached);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	f.key('F6', KeyModifier.shift);
	assert.ok(viewport.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6');
	assert.ok(parts.main.scope.contains(inputFocus.admittedTarget!.scope));
	assert.ok(group.model.activeTab === source && f.main.primary === f.client);
	assert.equal(f.model.canUndo, false);
});

test('Source from the viewport keeps its exact authored selection and opens through Main documents', async t => {
	const f = await fixture(t);
	const part = f.editor.editorParts.main, group = part.activeGroup;
	assert.equal(part.hasEditors, false); assert.equal(part.contentPresented, false);
	assert.equal(part.surface.visible, true); assert.equal(part.clientSurface.visible, false);
	t.after(group.onWillFocus(() => {
		assert.equal(part.contentPresented, true); assert.equal(group.presented, true);
		assert.equal(f.editor.surfaces.isFocusAdmitted(group.surface), true); return true;
	}));
	selectSceneOutlineRow(f.client.view.hierarchy, 2); f.update(); f.main.focusPrimary('viewport');
	const selection = f.client.consumer.selection, camera = f.client.view.viewport.camera.capture();
	const target = f.client.viewport.control.focusTarget;
	assert.equal(f.main.canOpenSource(target), true);
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.source', target);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result; f.update();
	const input = f.editor.editorParts.main.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.ok(part.activeGroup === group && group.focusScope.contains(inputFocus.admittedTarget!.scope));
	assert.ok(f.main.primary === f.client && f.client.consumer.selection === selection);
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera);
	assert.equal(f.client.viewport.attached, true);
	assert.equal(f.model.canUndo, false);
});

test('first preserve-focus document restores allocation without replacing primary focus or its retained group', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, group = part.activeGroup, origin = inputFocus.admittedTarget;
	group.openEditor(new CodeEditorInput(f.model), { preserveFocus: true }); f.update();
	assert.equal(part.contentPresented, true); assert.ok(part.activeGroup === group);
	assert.ok(inputFocus.admittedTarget === origin); assert.equal(f.client.viewport.attached, true);
});

for (const control of ['content', 'tabs'] as const)
test(`closing the final focused ${control} returns to the retained authored viewport and removes Documents from F6`, async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, group = part.activeGroup;
	const source = new CodeEditorInput(f.model); group.openEditor(source); f.update(); group.focus(control);
	const camera = f.client.view.viewport.camera.capture(), scope = group.focusScope;
	assert.equal(await group.close(source.id), true); f.update();
	assert.equal(part.contentPresented, false); assert.ok(part.activeGroup === group && group.focusScope === scope);
	assert.ok(f.client.viewport.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6'); assert.ok(f.client.details.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6', KeyModifier.shift); assert.ok(f.client.viewport.scope.contains(inputFocus.admittedTarget!.scope));
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera); assert.equal(f.model.canUndo, false);
});

test('bulk close retains both groups and returns only the displaced document focus', async t => {
	const f = await fixture(t), parts = f.editor.editorParts, part = parts.main, first = part.activeGroup;
	const firstInput = new CodeEditorInput(f.model); first.openEditor(firstInput);
	const second = part.splitGroup(first, 'down'), secondInput = new CodeEditorInput(f.model); second.openEditor(secondInput); f.update(); first.focus();
	assert.equal(await parts.closeController.close([{ group: first, input: firstInput }, { group: second, input: secondInput }], inputFocus.target, part.actionPrompt), true);
	f.update(); assert.equal(part.contentPresented, false); assert.ok(part.groups.includes(first) && part.groups.includes(second));
	assert.ok(f.client.viewport.scope.contains(inputFocus.admittedTarget!.scope));
});

test('group retirement cannot replace a newer focus-and-null request from disposal', async t => {
	const f = await fixture(t), parts = f.editor.editorParts, part = parts.main, group = part.activeGroup;
	group.openEditor(new CodeEditorInput(f.model));
	const sibling = part.splitGroup(group, 'down'); sibling.openEditor(new CodeEditorInput(f.model)); f.update(); group.focus();
	t.after(group.onWillDispose(() => { f.second.focus(); inputFocus.setTarget(null); }));
	assert.equal(await parts.closeGroup(group), true); f.update();
	assert.equal(inputFocus.target, null); assert.ok(part.groups.includes(sibling)); assert.equal(part.contentPresented, true);
});

test('a preserve-focus opening during clear revokes the old close receipt before a later background close', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, group = part.activeGroup;
	const source = new CodeEditorInput(f.model), incoming = new CodeEditorInput(f.firstInput.workingCopy);
	group.openEditor(source, { pinned: true }); f.update();
	let unbind: () => void;
	unbind = group.panes.onDidClearEditor(() => { unbind(); group.openEditor(incoming, { pinned: true, preserveFocus: true }); }); t.after(unbind);
	assert.equal(await group.close(source.id), true); f.update();
	assert.ok(group.model.activeTab === incoming); assert.equal(inputFocus.target, null);
	assert.equal(await group.close(incoming.id), true); f.update();
	assert.equal(part.contentPresented, false); assert.equal(inputFocus.target, null);
});

test('withdrawing the document companion cannot replace a newer focus-and-null request from blur', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, source = new CodeEditorInput(f.model), game = f.editor.gamePanel;
	f.editor.updateViewport({ width: 1200, height: 800 }); part.activeGroup.openEditor(source); game.toggle(); f.update();
	assert.equal(game.visible, true);
	const bounds = f.editor.editorParts.mainArea.companionBounds;
	pointer(f, bounds.left + 4, bounds.top + 4, PointerButton.Primary, PointerButton.Primary);
	pointer(f, bounds.left + 4, bounds.top + 4, 0, 0, PointerButton.Primary);
	const target = inputFocus.admittedTarget!; assert.ok(game.focusScope.contains(target.scope));
	t.after(target.onDidBlur(() => { f.second.focus(); inputFocus.setTarget(null); }));
	game.close(); f.update();
	assert.equal(game.visible, false); assert.equal(inputFocus.target, null);
	assert.ok(part.activeGroup.model.activeTab === source && f.main.primary === f.client);
});

for (const redirect of ['background', 'new focus', 'new focus then null'] as const)
test(`closing the final Main document preserves ${redirect}`, async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, group = part.activeGroup, source = new CodeEditorInput(f.model);
	group.openEditor(source); f.update();
	if (redirect === 'background') f.second.focus();
	else {
		let unbind: () => void;
		unbind = group.panes.onDidClearEditor(() => { unbind(); f.second.focus(); if (redirect === 'new focus then null') inputFocus.setTarget(null); });
		t.after(unbind);
	}
	assert.equal(await group.close(source.id), true); f.update(); assert.equal(part.contentPresented, false);
	if (redirect === 'new focus then null') assert.equal(inputFocus.target, null);
	else assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
});

test('an empty retained Main document family presents local modals without restoring blank allocation', async t => {
	const f = await fixture(t), part = f.editor.editorParts.main, origin = f.client.viewport.control.focusTarget;
	part.quickInput.input('', '', '', async value => value, undefined, undefined, { invocationOrigin: origin }); f.update();
	assert.equal(part.quickInput.visible, true); assert.equal(part.contentPresented, false);
	assert.ok(inputFocus.admittedTarget === part.quickInput.field.focusTarget);
	f.key('Escape'); assert.equal(part.quickInput.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	const decision = part.actionPrompt.show({ title: 'Pending action', message: 'Continue?', primary: 'Continue', secondary: 'Cancel', primaryEnabled: true, defaultChoice: 'cancel' }, origin); f.update();
	assert.equal(part.actionPrompt.visible, true); assert.equal(part.contentPresented, false);
	assert.ok(inputFocus.admittedTarget === origin); part.actionPrompt.focusTarget.focus();
	assert.ok(part.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('Escape'); assert.equal(await decision, 'cancel'); assert.ok(inputFocus.admittedTarget === origin);
});

for (const route of ['keyboard', 'pointer'] as const)
test(`the viewport ${route} context menu retains its native camera commands and returns to that same canvas`, async t => {
	const f = await fixture(t), viewport = f.client.viewport, origin = viewport.control.focusTarget;
	selectSceneOutlineRow(f.client.view.hierarchy, 2); f.update(); f.main.focusPrimary('viewport');
	const selected = f.client.consumer.selection;
	if (route === 'keyboard') f.key('ContextMenu');
	else {
		const bounds = viewport.layoutState.client, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
		pointer(f, x, y, PointerButton.Secondary, PointerButton.Secondary); pointer(f, x, y, 0, 0, PointerButton.Secondary);
	}
	const menu = f.editor.contextMenu;
	assert.equal(menu.visible, true); assert.ok(menu.returnFocus === origin);
	assert.ok(menu.model.rows.some(row => row.command === 'sceneViewport.frameAll' && row.enabled),
		'the popup addresses the actual canvas camera capability, not just its semantic source owner');
	assert.ok(menu.model.rows.some(row => row.command === 'editor.source' && row.enabled));
	f.key('Home'); f.key('Enter');
	assert.equal(menu.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	assert.ok(f.client.consumer.selection === selected);
	f.key('Escape');
	assert.ok(f.client.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.model.canUndo, false);
});

test('camera movement is retained reading state and an allocation change cancels its physical capture only', async t => {
	const f = await fixture(t), viewport = f.client.viewport, bounds = viewport.layoutState.client;
	f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(f.model), { preserveFocus: true }); f.update();
	const before = f.client.view.viewport.camera.capture(), selection = f.client.consumer.selection;
	const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	pointer(f, x, y, PointerButton.Auxiliary, PointerButton.Auxiliary);
	assert.equal(pointerCapture.active, true);
	pointer(f, x + 18, y + 9, PointerButton.Auxiliary);
	const moved = f.client.view.viewport.camera.capture(); assert.notDeepEqual(moved, before);
	f.main.regionLayout.viewportSplit.resize(0.8); f.update();
	assert.equal(pointerCapture.active, false);
	assert.ok(f.client.viewport === viewport && viewport.attached);
	assert.deepEqual(f.client.view.viewport.camera.capture(), moved);
	pointer(f, x + 35, y + 24, 0, 0, PointerButton.Auxiliary);
	assert.deepEqual(f.client.view.viewport.camera.capture(), moved);
	assert.ok(f.client.consumer.selection === selection);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('suspension retires viewport authority but preserves camera, source subject and the actual document part', async t => {
	const f = await fixture(t), viewport = f.client.viewport, generation = viewport.scope.contextGeneration;
	f.editor.commands.execute('sceneViewport.view3d', viewport.commandTarget); f.update();
	const camera = f.client.view.viewport.camera.capture(), documents = f.editor.editorParts.main;
	assert.equal(f.main.canOpenSource(viewport.control.focusTarget), true);
	f.main.suspend();
	assert.equal(viewport.attached, false); assert.ok(viewport.scope.contextGeneration > generation);
	assert.equal(f.main.canOpenSource(viewport.control.focusTarget), false);
	assert.equal(pointerCapture.active, false);
	f.main.resume(); f.update(); f.main.focusPrimary('viewport');
	assert.ok(f.main.primary === f.client && f.client.viewport === viewport && viewport.attached);
	assert.ok(f.editor.editorParts.main === documents && viewport.scope.contains(inputFocus.admittedTarget!.scope));
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera);
	assert.equal(f.model.canUndo, false);
});

test('primary bookmarks and workspace placement record camera and focus independently of document topology', async t => {
	const f = await fixture(t), viewport = f.client.viewport;
	f.editor.commands.execute('sceneViewport.view3d', viewport.commandTarget); f.update();
	f.main.regionLayout.viewportSplit.resize(0.8); f.update(); f.main.focusPrimary('viewport');
	const camera = f.client.view.viewport.camera.capture(), source = captureScenePrimary(f.client.view), workspace = f.main.serialize();
	assert.deepEqual(source.view.camera, camera);
	assert.equal(source.view.preferredPart, 'viewport');
	assert.equal(workspace.activePrimaryPart, 'viewport');
	assert.equal(workspace.viewportRatio, f.main.regionLayout.viewportSplit.ratio);
	const bookmark = f.client.captureNavigationLocation()!; t.after(() => bookmark.dispose());
	f.main.resetLayout(); f.update();
	assert.ok(f.main.primary === f.client && f.client.viewport === viewport);
	assert.deepEqual(f.client.view.viewport.camera.capture(), camera);
	assert.equal(f.main.regionLayout.viewportSplit.ratio, f.main.regionLayout.viewportSplit.defaultRatio);
	assert.equal(f.model.canUndo, false);
});

test('a client retired during viewport allocation cannot reattach its side regions or take document focus', async t => {
	const f = await fixture(t), viewport = f.client.viewport;
	const layout = t.mock.method(viewport, 'layout', () => { layout.mock.restore(); f.main.reset(); f.second.focus(); });
	assert.doesNotThrow(() => { f.main.regionLayout.viewportSplit.resize(0.8); f.update(); });
	assert.equal(layout.mock.callCount(), 1);
	assert.equal(f.main.primary, undefined);
	assert.equal(viewport.attached, false);
	assert.equal(f.client.hierarchy.attached, false); assert.equal(f.client.details.attached, false);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.equal(f.model.canUndo, false);
});
