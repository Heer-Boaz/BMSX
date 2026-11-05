import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { createLiveStudioFixture } from '../helpers/live_studio';

async function fixture(t: TestContext) {
	const f = await createLiveStudioFixture(t), { editor, native } = f;
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	editor.actorLab.open(part.activeGroup); editor.update(0);
	const input = editor.actorLab.resolveInput(), pane = part.activeGroup.panes.activePane!;
	assert.ok(pane instanceof ActorLabEditorPane);
	const pointer = (x: number, y: number) => native.apply([{ type: 'pointer', x, y }]);
	const button = (button: 'primary' | 'secondary' | 'aux', down: boolean) => native.apply([{ type: 'button', button, down }]);
	const click = (x: number, y: number) => { pointer(x, y); button('primary', true); button('primary', false); };
	const key = (code: string, down: boolean, modifiers = KeyModifier.none) => {
		native.apply([{ type: 'key', code, down }]);
		const event = new KeyInputEvent(code, modifiers, false, down); editor.dispatchKey(event); return event.consumed;
	};
	const action = (command: EditorCommandId) => {
		const item = input.viewportActions.items.find(item => item.command === command)!;
		assert.ok(item.enabled && !item.overflowed);
		click((item.bounds.left + item.bounds.right) / 2, (item.bounds.top + item.bounds.bottom) / 2);
		assert.equal(editor.contextMenu.visible, true);
	};
	const choose = (command: EditorCommandId) => {
		const model = editor.contextMenu.model, row = model.rows.find(row => row.command === command)!;
		assert.ok(row.enabled);
		click((model.viewport.bounds.left + model.viewport.bounds.right) / 2, model.viewport.offsetTop + (row.top + row.bottom) / 2);
		assert.equal(editor.contextMenu.visible, false); editor.update(0);
	};
	const point = () => ({ x: (input.previewBounds.left + input.previewBounds.right) / 2,
		y: (input.previewBounds.top + input.previewBounds.bottom) / 2 });
	return { ...f, input, pane, pointer, button, click, key, action, choose, point };
}

test('viewport overlays switch the actual view, report checked modes and do not select actors underneath', async t => {
	const f = await fixture(t), { input, editor, pane, action, choose } = f, view = input.worldView;
	const hash = input.actorHashId, reading = view.camera.capture();
	action('actorLab.viewOptions');
	assert.equal(input.actorHashId, hash); assert.deepEqual(view.camera.capture(), reading);
	assert.equal(editor.contextMenu.model.rows.find(row => row.command === 'sceneViewport.view2d')!.active, true);
	choose('sceneViewport.view3d'); assert.equal(view.mode, '3d');
	action('actorLab.viewOptions');
	assert.equal(editor.contextMenu.model.rows.find(row => row.command === 'sceneViewport.view3d')!.active, true);
	choose('sceneViewport.view2d'); assert.equal(view.mode, '2d'); assert.deepEqual(view.camera.capture().canvas, reading.canvas);
	action('actorLab.cameraOptions');
	assert.equal(editor.contextMenu.model.rows.find(row => row.command === 'sceneViewport.orbit')!.enabled, false);
	choose('sceneViewport.pan');
	const p = f.point(), pan = view.camera.capture();
	f.pointer(p.x, p.y); f.button('primary', true); f.pointer(p.x + 12, p.y + 7); f.button('primary', false);
	assert.notDeepEqual(view.camera.capture(), pan); assert.equal(input.actorHashId, hash, 'single-pointer camera mode never becomes actor selection');
	action('actorLab.cameraOptions');
	assert.equal(editor.contextMenu.model.rows.find(row => row.command === 'sceneViewport.pan')!.active, true);
	choose('actorLab.selectVisual');
	action('actorLab.viewOptions'); choose('actorLab.gameView');
	assert.equal(view.mode, 'game'); assert.equal(editor.commands.isEnabled('actorLab.cameraOptions', pane.commandTarget), false);
	action('actorLab.viewOptions'); choose('sceneViewport.view3d');
	action('actorLab.cameraOptions'); choose('sceneViewport.orbit');
	action('actorLab.viewOptions'); choose('sceneViewport.view2d');
	assert.equal(view.navigationTool, 'select', 'a 3D-only gesture is retired when returning to 2D');
	action('actorLab.viewOptions');
	editor.editorParts.clear();
	assert.equal(editor.contextMenu.visible, false, 'detaching the viewport retires its open menu');
});

test('UE-style look, orbit, dolly and held-key flight move only the editor camera and reuse retained rendering', async t => {
	const f = await fixture(t), { input, runtime, editor, key, action, choose } = f, view = input.worldView;
	action('actorLab.viewOptions'); choose('sceneViewport.view3d');
	const p = f.point(), before = new Float64Array(3), after = new Float64Array(3), camera = view.camera;
	const cycles = runtime.machine.scheduler.nowCycles;
	const reads = t.mock.method(f.ide.guest, 'readStringMember'), textures = t.mock.method(view.assets, 'texture');
	camera.eyeRelativeTo(0, 0, 0, before);
	f.pointer(p.x, p.y); f.button('secondary', true); f.pointer(p.x + 15, p.y + 6);
	camera.eyeRelativeTo(0, 0, 0, after);
	for (let i = 0; i < 3; i++) assert.ok(Math.abs(after[i] - before[i]) < 1e-10, 'RMB looks from a fixed eye instead of orbiting');
	assert.equal(key('KeyW', true), true);
	await f.frame(); await f.frame();
	camera.eyeRelativeTo(0, 0, 0, after); assert.notDeepEqual(after, before, 'held keys advance even without pointer motion');
	const moving = camera.capture();
	f.native.apply([{ type: 'wheel', deltaY: -4 }]);
	assert.equal(view.navigationSpeed, 2); assert.deepEqual(camera.capture(), moving, 'RMB+wheel controls flight speed, not zoom');
	f.button('secondary', false);
	const stopped = camera.capture(); await f.frame();
	assert.deepEqual(camera.capture(), stopped, 'releasing RMB ends flight even while W is still down');
	key('KeyW', false);
	const pivot = camera.capture().space;
	key('AltLeft', true, KeyModifier.alt);
	f.pointer(p.x, p.y); f.button('primary', true); f.pointer(p.x + 18, p.y - 4); f.button('primary', false);
	const orbit = camera.capture().space;
	assert.equal(orbit.centerX, pivot.centerX); assert.equal(orbit.centerY, pivot.centerY); assert.equal(orbit.centerZ, pivot.centerZ);
	assert.notEqual(orbit.yaw, pivot.yaw);
	f.button('secondary', true); f.pointer(p.x + 18, p.y + 12); f.button('secondary', false);
	assert.notEqual(camera.capture().space.distance, orbit.distance, 'Alt+RMB dollies around the pivot');
	key('AltLeft', false);
	assert.equal(reads.mock.callCount(), 0, 'navigation does not scan the guest heap');
	assert.equal(textures.mock.callCount(), 0, 'navigation does not decode appearances again');
	assert.equal(runtime.machine.scheduler.nowCycles, cycles, 'camera navigation leaves the paused guest untouched');
	reads.mock.restore(); textures.mock.restore();
	action('actorLab.viewOptions'); choose('sceneViewport.view2d');
	const flat = camera.capture().canvas;
	f.pointer(p.x, p.y); f.button('secondary', true); f.pointer(p.x + 14, p.y - 9); f.button('secondary', false);
	assert.notDeepEqual(camera.capture().canvas, flat, 'RMB pans in 2D');
	assert.equal(editor.contextMenu.visible, false, 'navigation never opens an actor context menu');
});

test('flight capture is cancelled by focus loss, popups and input interruption, and does not reserve gameplay keys', async t => {
	const f = await fixture(t), { input, pane, editor, action, choose, key } = f, view = input.worldView;
	action('actorLab.viewOptions'); choose('sceneViewport.view3d');
	for (const interrupt of [() => pane.focus(), () => editor.cancelInput(),
		() => editor.commands.execute('actorLab.viewOptions', pane.commandTarget)]) {
		const p = f.point(); f.pointer(p.x, p.y); f.button('secondary', true); key('KeyD', true);
		await f.frame();
		assert.equal(pointerCapture.active, true);
		interrupt(); const reading = view.camera.capture();
		assert.equal(pointerCapture.active, false); await f.frame();
		assert.deepEqual(view.camera.capture(), reading);
		f.button('secondary', false); key('KeyD', false);
		if (editor.contextMenu.visible) { key('Escape', true); key('Escape', false); }
	}
	action('actorLab.viewOptions'); choose('actorLab.gameView');
	const p = f.point(); f.click(p.x, p.y);
	assert.ok(inputFocus.target?.guestInput, 'Game mode still focuses the existing guest-input recipient');
	for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF']) {
		assert.equal(key(code, true), false, `${code} belongs to gameplay, not camera commands`); key(code, false);
	}
	action('actorLab.viewOptions'); choose('sceneViewport.view3d');
	assert.equal(inputFocus.target?.guestInput, undefined, 'overlay activation leaves guest input before entering the editor view');
});
