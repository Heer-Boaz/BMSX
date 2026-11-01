import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { TranslateHandle } from '../../ide/workbench/contrib/scene_editor/viewport/translate_gizmo';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const BOUNDS = { left: 10, top: 20, right: 410, bottom: 260 };
const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d')})`;
const MEMBERS = `{member_id='parent',definition_id='node2',transform = { xx = 2, xy = 1, yx = 1, yy = 3, ox = 10, oy = 20 }},
 {member_id='child',definition_id='node2',parent='parent',transform = { xx = 0, xy = 0, yx = 0, yy = 0, ox = 4, oy = 5 }},
 {member_id='descendant',definition_id='node2',parent='child',position = { x = 7, y = 8 }}`;

function pointer(x: number, y: number, pressed: number = PointerButton.Primary, justPressed = 0, justReleased = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: pressed, justPressedButtons: justPressed, justReleasedButtons: justReleased,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}
function fixture(t: TestContext, members = MEMBERS) {
	configureFontVariant('tiny');
	const source = `local scenes=require('cartlib/world/scene_library')\nscenes.register('main',{objects={${members}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', PREFABS]]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const view = new SceneViewportViewState(context, f.sources.catalog), scope = new InputFocusScope(Symbol('translation'), inputFocus.workbenchScope);
	const panel = inputFocus.createTarget(null, scope), control = new SceneViewportControl(scope, panel); panel.commandContext = panel;
	control.setView(view, BOUNDS);
	const select = (index: number) => {
		context.refresh(); const scene = context.subject!;
		assert.equal(context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true); control.update();
	};
	const start = (axis = 0) => {
		const points = view.gizmo.axes[axis], x = (points[0] + points[2]) / 2, y = (points[1] + points[3]) / 2;
		assert.equal(view.gizmo.hit(x, y), 1 << axis);
		assert.equal(control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true), true);
		assert.equal(pointerCapture.active, true); assert.ok(view.transformPreview !== undefined);
		return { x, y };
	};
	const move = (x: number, y: number) => pointerCapture.dispatch(pointer(x, y), false, 0, scope.surfaceScope);
	const release = (x: number, y: number) => pointerCapture.dispatch(pointer(x, y, 0, 0, PointerButton.Primary), false, 0, scope.surfaceScope);
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, context, view, scope, panel, control, select, start, move, release };
}

test('pixel-snapped 2D translation previews a singular child/subtree, then commits one source edit and one Undo', t => {
	const f = fixture(t); f.select(1);
	const entry = f.view.selected!, sourceWorld = f.view.source!.worlds.get(entry)!, before = { ...sourceWorld }, sourceVersion = f.model.version;
	const scale = f.view.camera.scale, { x, y } = f.start(), preview = f.view.transformPreview!, world = preview.worlds.get(entry)!;
	for (let step = 1; step <= 100; step++) f.move(x + step / 5, y + step / 10);
	assert.ok(f.view.transformPreview === preview && preview.worlds.get(entry) === world, 'one proposal and its numeric poses survive every pointer update');
	assert.equal(f.model.version, sourceVersion); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.deepEqual(sourceWorld, before, 'the immutable authored pose cache is not preview storage');
	const dx = Math.round(sourceWorld.ox + 20 / scale) - sourceWorld.ox;
	assert.equal(world.ox, sourceWorld.ox + dx); assert.equal(world.oy, sourceWorld.oy);
	const descendant = f.context.subject!.objects[2]; assert.equal(descendant.kind, 'object');
	assert.equal(preview.worlds.get(descendant)!.ox - f.view.source!.worlds.get(descendant)!.ox, dx);
	f.release(x + 20, y + 10);
	assert.equal(pointerCapture.active, false); assert.equal(f.view.transformPreview, undefined); assert.equal(f.model.canUndo, true);
	assert.ok(f.model.buffer.getText().includes("parent='parent',transform = { xx = 0, xy = 0, yx = 0, yy = 0,"), 'translation does not rewrite the direct parent or singular basis');
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.index === 1);
	const committed = f.model.buffer.getText(); assert.notEqual(committed, f.source);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.model.redo(); assert.equal(f.model.buffer.getText(), committed);
});

test('an accepted press with no displacement does not materialize an inherited transform or create history', t => {
	const f = fixture(t, `{member_id='root',definition_id='node2'}`); f.select(0);
	const { x, y } = f.start(); f.release(x, y);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(f.view.transformPreview, undefined);
});

test('Escape abandons preview, restores the displayed source pose and writes no canonical bytes', t => {
	const f = fixture(t); f.select(1); const entry = f.view.selected!, before = { ...f.view.source!.worlds.get(entry)! }, { x, y } = f.start();
	f.move(x + 20, y); assert.notEqual(f.view.transformPreview!.worlds.get(entry)!.ox, before.ox);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(pointerCapture.active, false); assert.equal(f.view.transformPreview, undefined); assert.equal(f.view.gizmo.active, TranslateHandle.None);
	assert.equal(f.view.gizmo.world!.ox, before.ox); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.release(x + 20, y); assert.equal(f.model.buffer.getText(), f.source);
});

const RETIREMENTS: readonly [string, (f: ReturnType<typeof fixture>) => void][] = [
	['selection change', f => f.select(0)],
	['camera navigation', f => f.view.camera.pan(7, 9)],
	['allocation change', f => f.control.layout({ ...BOUNDS, right: 510 })],
	['source generation', f => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external\n' }])],
	['semantic provider generation', f => {
		const resource = f.sources.catalog.resolveResource({ contextId: f.model.identity.contextId, path: 'prefabs.lua' })!;
		resolveLuaTextFileModel(f.models, f.sources.catalog, resource).pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- provider\n' }]);
	}],
	['packed asset generation', f => f.sources.catalog.rebuildResources()],
	['read-only capability', f => f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } })],
	['scope retirement', f => f.control.focusTarget.scope.retireContext()],
	['attachment replacement', f => { const incoming = new SceneViewportViewState(f.context, f.sources.catalog); f.control.setView(incoming, BOUNDS); incoming.dispose(); }],
];
for (const [name, retire] of RETIREMENTS) test(`${name} revokes a held translation instead of redirecting or committing it`, t => {
	const f = fixture(t); f.select(1); const { x, y } = f.start(); f.move(x + 20, y);
	retire(f); const afterExternal = f.model.buffer.getText(), canUndoAfterExternal = f.model.canUndo; f.control.update();
	f.release(x + 30, y); assert.equal(f.model.buffer.getText(), afterExternal);
	assert.equal(f.view.transformPreview, undefined); assert.equal(pointerCapture.active, false);
	assert.equal(f.model.canUndo, canUndoAfterExternal);
});

test('perspective world-axis move edits the declared 3D origin, never the editor camera', t => {
	const f = fixture(t, `{member_id='mesh',definition_id='node3'}`); f.select(0);
	const camera = f.view.camera.capture(), { x, y } = f.start(0);
	f.move(x + 13, y + 7); const preview = { ...f.view.transformPreview!.worlds.get(f.view.selected!)! };
	f.release(x + 13, y + 7); const entry = f.context.subject!.objects[0]; assert.ok(entry.kind === 'object');
	const world = f.context.spatialScene!.worlds.get(entry)!;
	assert.deepEqual(world, preview); assert.deepEqual(f.view.camera.capture(), camera);
	assert.equal(world.family, '3d'); assert.notEqual(world.ox, 0); assert.equal(world.oy, 0); assert.equal(world.oz, 0);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('font changes retire physical move geometry instead of continuing against stale handle metrics', t => {
	const f = fixture(t); f.select(1); const { x, y } = f.start(); f.move(x + 20, y);
	configureFontVariant('msx'); f.control.layout(BOUNDS); f.control.update(); f.release(x + 20, y);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('an older layout continuation cannot revoke a replacement attachment gesture', t => {
	const f = fixture(t); f.select(1);
	const incoming = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => incoming.dispose());
	let x = 0, y = 0;
	const unbind = f.view.camera.onDidChange(() => {
		unbind(); f.control.setView(incoming, BOUNDS);
		const points = incoming.gizmo.axes[0]; x = (points[0] + points[2]) / 2; y = (points[1] + points[3]) / 2;
		f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true);
	});
	t.after(unbind);
	f.control.layout({ ...BOUNDS, right: 510 });
	assert.ok(f.control.view === incoming); assert.equal(pointerCapture.active, true); assert.ok(incoming.transformPreview !== undefined);
	f.move(x + 20, y); f.release(x + 20, y); assert.equal(f.model.canUndo, true);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});
