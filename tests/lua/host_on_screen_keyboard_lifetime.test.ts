import assert from 'node:assert/strict';
import test from 'node:test';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { OnScreenKeyboardCommand, NATIVE_KEYBOARD_PAGES } from '../../hosts/common/input/on_screen_keyboard_keys';
import { Input } from '../../hosts/common/input/manager';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostFrameFixture } from '../helpers/host_frame';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostRewind } from '../../hosts/common/rewind';

function fixture() {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const keyboard = new OnScreenKeyboard(input, NATIVE_KEYBOARD_PAGES);
	keyboard.open();
	const snapshot = createInputControllerSnapshot();
	const writes: Array<{ code: string; down: boolean }> = [];
	const publish = input.setVirtualKeyboardKey.bind(input);
	input.setVirtualKeyboardKey = (code, down) => { writes.push({ code, down }); publish(code, down); };
	return {
		input, keyboard, writes, clock,
		poll(delta = 20) {
			clock.advance(delta);
			input.pollInput();
			input.sampleInputControllerSnapshot(snapshot, 0);
			return snapshot;
		},
		pressed(code: string) {
			const usage = hidKeyUsageForCode(code);
			return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0;
		},
	};
}

for (const hostHz of [60, 120]) {
	test(`virtual key lifetime survives every host poll throughout a 100 ms source hold at ${hostHz} Hz`, t => {
		const f = fixture();
		t.after(() => f.input.dispose());
		f.keyboard.activate(0);
		for (let frame = 0; frame < hostHz / 10; frame += 1) {
			f.poll(1000 / hostHz);
			assert.equal(f.pressed('KeyQ'), true);
		}
		f.keyboard.releaseSource(0);
		f.poll();
		assert.equal(f.pressed('KeyQ'), false);
		assert.deepEqual(f.writes, [{ code: 'KeyQ', down: true }, { code: 'KeyQ', down: false }]);
	});
}

test('a controller and the logical pointer retain independent contributions to the same selected key', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.activate(OnScreenKeyboard.POINTER_SOURCE);
	f.poll();
	assert.equal(f.pressed('KeyQ'), true);
	f.keyboard.releaseSource(0);
	f.poll();
	assert.equal(f.pressed('KeyQ'), true, 'the remaining pointer hold cannot be released by the controller');
	f.keyboard.releaseSource(OnScreenKeyboard.POINTER_SOURCE);
	f.poll();
	assert.equal(f.pressed('KeyQ'), false);
	assert.deepEqual(f.writes, [{ code: 'KeyQ', down: true }, { code: 'KeyQ', down: false }]);
});

test('the actual host-menu producer forwards simultaneous controller commands and pointer holds independently', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	for (let pad = 0; pad < 2; pad += 1) {
		f.input.connectInputDevice({ id: `gamepad:${pad}`, kind: 'gamepad', gamepadIndex: pad, label: 'PAD',
			vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	}
	const queue = new HostOverlayQueue();
	const presenter = {
		viewportSize: { x: 256, y: 212 },
		visibleViewportBounds: { left: 0, top: 0, right: 256, bottom: 212 },
		default_font: { lineHeight: 8, measure: (text: string) => text.length * 6 },
		hostOverlayQueue: queue,
		mapDisplayPointToViewport(x: number, y: number, point: { x: number; y: number }) { point.x = x; point.y = y; return true; },
	} as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, f.input, {} as HostRewind, createHostFrameFixture().execution);
	const tick = () => { f.poll(); menu.tickInput(); f.poll(); };
	let pressId = 0;
	const button = (device: string, code: string, down: boolean) => f.input.inputButton(device, code, down, down ? 1 : 0, f.clock.now() + 1, ++pressId);
	tick();
	button('gamepad:0', 'select', true);
	button('gamepad:0', 'x', true);
	tick();
	button('gamepad:0', 'select', false);
	button('gamepad:0', 'x', false);
	tick();
	menu.queueRenderCommands();
	const frame = queue.consumeHostMenuFrame();
	let q: GlyphRenderSubmission | undefined;
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] === Host2DKind.Glyphs && (frame.commandRefs[index] as GlyphRenderSubmission).items === 'q') q = frame.commandRefs[index] as GlyphRenderSubmission;
	}
	assert.ok(q, 'ordinary host shortcut opened the real keyboard page');
	f.input.inputAxis2('pointer:0', 'pointer_position', q.x + 1, q.y + 1, f.clock.now() + 1);
	button('pointer:0', 'pointer_primary', true);
	button('gamepad:0', 'a', true);
	button('gamepad:0', 'x', true);
	button('gamepad:1', 'b', true);
	tick();
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.pressed('Backspace'), true, 'simultaneous X is not dropped by the selected A command');
	assert.equal(f.pressed('Space'), true, 'the second controller contributes independently');
	const downs = f.writes.filter(write => write.down);
	for (let frame = 0; frame < 30; frame += 1) tick();
	assert.deepEqual(f.writes.filter(write => write.down), downs, 'keyboard controller commands do not produce host typematic pulses');
	button('gamepad:0', 'a', false);
	button('gamepad:0', 'x', false);
	button('gamepad:1', 'b', false);
	tick();
	assert.equal(f.pressed('KeyQ'), true, 'the pointer retains Q after all controller sources release');
	assert.equal(f.pressed('Backspace'), false);
	assert.equal(f.pressed('Space'), false);
	button('pointer:0', 'pointer_primary', false);
	tick();
	assert.equal(f.pressed('KeyQ'), false);
	menu.dismiss();
});

test('moving keyboard selection cannot retarget held keys, and different keys stay independently held', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.moveHorizontal(1);
	f.keyboard.activate(OnScreenKeyboard.POINTER_SOURCE);
	f.keyboard.command(2, OnScreenKeyboardCommand.Backspace);
	f.poll();
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.pressed('KeyW'), true);
	assert.equal(f.pressed('Backspace'), true);
	f.keyboard.releaseSource(2);
	f.keyboard.releaseSource(0);
	f.poll();
	assert.equal(f.pressed('KeyQ'), false);
	assert.equal(f.pressed('Backspace'), false);
	assert.equal(f.pressed('KeyW'), true);
	f.keyboard.releaseSource(OnScreenKeyboard.POINTER_SOURCE);
	f.poll();
	assert.equal(f.pressed('KeyW'), false);
});

test('one-shot Shift accompanies every contributing key through its whole physical hold', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.keyboard.command(3, OnScreenKeyboardCommand.Shift);
	f.keyboard.activate(0);
	f.keyboard.moveHorizontal(1);
	f.keyboard.activate(1);
	f.poll();
	assert.equal(f.pressed('ShiftLeft'), true);
	f.keyboard.releaseSource(0);
	f.poll();
	assert.equal(f.pressed('ShiftLeft'), true, 'a remaining shifted key owns the modifier after the first key releases');
	assert.equal(f.pressed('KeyW'), true);
	f.keyboard.releaseSource(1);
	f.poll();
	assert.equal(f.pressed('ShiftLeft'), false);
	f.keyboard.activate(0);
	f.poll();
	assert.equal(f.pressed('KeyW'), true);
	assert.equal(f.pressed('ShiftLeft'), false, 'the next press is unshifted after the one-shot finishes');
});

test('turning off a sticky modifier does not remove it from a key already held with that modifier', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	for (let row = 0; row < 3; row += 1) f.keyboard.moveVertical(1);
	f.keyboard.moveHorizontal(-1); // CTRL, adjacent to ALT at the same authored row.
	f.keyboard.activate(3);
	f.poll();
	assert.equal(f.pressed('ControlLeft'), true);
	f.keyboard.command(0, OnScreenKeyboardCommand.Space);
	f.keyboard.activate(3);
	f.poll();
	assert.equal(f.pressed('ControlLeft'), true);
	assert.equal(f.pressed('Space'), true);
	f.keyboard.releaseSource(0);
	f.poll();
	assert.equal(f.pressed('ControlLeft'), false);
	assert.equal(f.pressed('Space'), false);
});

test('held special keys publish one down/up pair; guest firmware owns typematic repeat', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.keyboard.command(0, OnScreenKeyboardCommand.Backspace);
	for (let frame = 0; frame < 120; frame += 1) {
		f.poll(1000 / 120);
		assert.equal(f.pressed('Backspace'), true);
	}
	f.keyboard.releaseSource(0);
	f.poll();
	assert.deepEqual(f.writes, [{ code: 'Backspace', down: true }, { code: 'Backspace', down: false }]);
});

test('closing the keyboard releases every source, special key and sticky or captured modifier', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.keyboard.command(3, OnScreenKeyboardCommand.Shift);
	f.keyboard.activate(0);
	f.keyboard.command(1, OnScreenKeyboardCommand.Home);
	f.keyboard.command(2, OnScreenKeyboardCommand.End);
	f.keyboard.activate(OnScreenKeyboard.POINTER_SOURCE);
	f.poll();
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.pressed('Home'), true);
	assert.equal(f.pressed('End'), true);
	assert.equal(f.pressed('ShiftLeft'), true);
	f.keyboard.close();
	assert.ok(f.poll().keyWords.every(word => word === 0));
	f.keyboard.open();
	f.keyboard.activate(0);
	f.poll();
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.pressed('ShiftLeft'), false);
});
