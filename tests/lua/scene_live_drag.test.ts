import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ActorRenderFrame } from '../../ide/workbench/contrib/actor_lab/render_geometry';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneLivePositionDrag } from '../../ide/workbench/contrib/scene_editor/live_drag';
import { SceneLivePosition } from '../../ide/workbench/contrib/scene_editor/live_positions';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='object',class=require('cartlib/world/object_2d')})
scenes.register('scene',{objects={{member_id='child',definition_id='object',position={x=4,y=5}}}})`;
const BOUNDS = { left: 0, top: 0, right: 400, bottom: 240 };
function pointer(x: number, y: number, release = false): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: release ? 0 : PointerButton.Primary,
		justPressedButtons: 0, justReleasedButtons: release ? PointerButton.Primary : 0,
		valid: true, insideViewport: true, modifiers: KeyModifier.alt, spaceDown: false };
}
function fixture(t: TestContext) {
	const f = createSceneSourceFixture(t, SOURCE, 'scene.lua', undefined, [['cartlib/world/prefab.lua', 'return {define=function() end}']]);
	const document = f.documents.get(f.model), scene = document.scenes[0];
	const context = new SceneAuthoringContext(f.model, f.documents, { document, scene, sourceVersion: f.model.version });
	context.select(document, f.model.version, { kind: 'member', scene, index: 0, entry: scene.objects[0] });
	const binding = new SceneLivePosition({ domain: 0, actorHashId: 1, worldHashId: 2, sceneHashId: 3, generation: 0, memberIndex: 1 }, context, 4, 5, 41, () => {});
	const frame = new ActorRenderFrame(), quad = frame.quads.get(0);
	Object.assign(quad, { hashId: 1, localX: 4, localY: 5, parentHashId: 41, parentXX: 2, parentXY: 1, parentYX: 1, parentYY: 3,
		ox: 150, oy: 60, ax: 12, ay: 0, bx: 0, by: 8 });
	const hit = { domain: 0 as const, hashId: 1, label: '', quadIndex: 0, left: 150, top: 60, right: 162, bottom: 68 };
	const scope = new InputFocusScope(Symbol('live drag'), inputFocus.workbenchScope), focus = inputFocus.createTarget(null, scope);
	focus.commandContext = focus; focus.focus();
	const drag = new SceneLivePositionDrag(); let current = true;
	const start = () => drag.begin(binding, quad, hit, pointer(100, 100), BOUNDS, 400, 240, focus, () => current);
	const move = (x: number, y: number) => pointerCapture.dispatch(pointer(x, y), false, 0, scope.surfaceScope);
	const release = (x: number, y: number) => pointerCapture.dispatch(pointer(x, y, true), false, 0, scope.surfaceScope);
	t.after(() => { pointerCapture.interrupt(false); inputFocus.setTarget(null); binding.dispose(); });
	return { ...f, context, binding, quad, drag, focus, start, move, release, retireFrame: () => { current = false; } };
}

test('live drag uses the displayed parent basis, never visual/presentation offsets, and creates one source Undo', t => {
	const f = fixture(t); assert.equal(f.start(), true);
	const queries = t.mock.method(f.documents, 'get');
	for (let i = 0; i < 100; i++) f.move(110, 120);
	assert.equal(queries.mock.callCount(), 0, 'pointer motion consumes retained revisions, not source or heap scans');
	assert.equal(f.model.buffer.getText(), SOURCE);
	f.release(110, 120);
	// [2 1; 1 3] * [2; 6] = [10; 20]. The visual origin is deliberately unrelated.
	assert.equal(f.model.buffer.getText(), SOURCE.replace('x=4,y=5', 'x=6,y=11'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const reason of ['image replaced', 'source changed', 'focus lost', 'owner retired', 'capture lost'] as const)
test(`live drag cannot commit after ${reason}`, t => {
	const f = fixture(t); assert.equal(f.start(), true); f.move(110, 120);
	if (reason === 'image replaced') f.retireFrame();
	else if (reason === 'source changed') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
	else if (reason === 'focus lost') inputFocus.setTarget(null);
	else if (reason === 'owner retired') f.binding.dispose();
	else pointerCapture.interrupt(false);
	f.release(110, 120);
	assert.equal(f.model.buffer.getText(), reason === 'source changed' ? '-- changed\n' + SOURCE : SOURCE);
	assert.equal(f.drag.active, false);
});

test('a singular parent or a displayed local pose different from source is not a draggable source position', t => {
	const f = fixture(t);
	f.quad.parentXX = 0; f.quad.parentXY = 0; assert.equal(f.start(), false);
	f.quad.parentXX = 2; f.quad.parentXY = 1; f.quad.localX = 42; assert.equal(f.start(), false);
	assert.equal(f.model.canUndo, false);
});
