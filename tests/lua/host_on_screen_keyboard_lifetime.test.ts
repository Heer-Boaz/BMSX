import assert from 'node:assert/strict';
import test from 'node:test';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { KeyboardPage, OnScreenKeyboardCommand, ON_SCREEN_KEYBOARD_POSITION_TARGET, NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_INDEX_BY_CODE } from '../../hosts/common/input/on_screen_keyboard_keys';
import { Input } from '../../hosts/common/input/manager';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { HostOnScreenKeyboard } from '../../hosts/common/host_on_screen_keyboard';
import { HostKeyboardInteraction } from '../../hosts/common/input/host_keyboard_interaction';
import { HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, HostImageRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
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

test('the composed keyboard owner forwards simultaneous controller commands and pointer holds independently', t => {
	const f = fixture(); f.keyboard.close();
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
	const keyboardView = new HostOnScreenKeyboard(presenter, f.keyboard);
	const keyboardInteraction = new HostKeyboardInteraction(f.input, f.keyboard, presenter, keyboardView);
	const menu = new HostOverlayMenu(presenter, {} as Runtime, f.input, {} as HostRewind, createHostFrameFixture().execution, keyboardInteraction);
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


for (const bitmap of [true, false]) {
	test(`visible docking icon activation is edge-triggered and presentation-owned (${bitmap ? 'bitmap' : 'external'})`, t => {
		const f = fixture(); f.keyboard.close();
		for (let player = 0; player < 2; player += 1) {
			f.input.connectInputDevice({ id: `gamepad:${player}`, kind: 'gamepad', gamepadIndex: player, label: 'PAD',
				vibrationInitialization: null, supportsVibration: false, setVibration() {} });
		}
		const queue = new HostOverlayQueue();
		const presenter = { viewportSize: { x: 256, y: 212 }, visibleViewportBounds: { left: 0, top: 0, right: 256, bottom: 212 },
			default_font: { lineHeight: 8, measure: (text: string) => text.length * 6 }, hostOverlayQueue: queue,
			mapDisplayPointToViewport(x: number, y: number, point: { x: number; y: number }) { point.x = x; point.y = y; return true; },
		} as VideoPresenter;
		const keyboardView = bitmap ? new HostOnScreenKeyboard(presenter, f.keyboard) : undefined;
		const keyboardInteraction = new HostKeyboardInteraction(f.input, f.keyboard, presenter, keyboardView);
		const menu = new HostOverlayMenu(presenter, {} as Runtime, f.input, {} as HostRewind,
			createHostFrameFixture().execution, keyboardInteraction);
		let pressId = 0, relocations = 0;
		if (keyboardView) {
			const toggle = keyboardView.togglePosition.bind(keyboardView);
			keyboardView.togglePosition = () => { relocations += 1; toggle(); };
		}
		t.after(() => { menu.dismiss(); f.input.dispose(); });
		const button = (player: number, code: string, down: boolean) => f.input.inputButton(`gamepad:${player}`, code, down, down ? 1 : 0, f.clock.now() + 1, ++pressId);
		const tick = () => { f.poll(); menu.tickInput(); f.poll(); };
		const press = (player: number, code: string) => { button(player, code, true); tick(); button(player, code, false); tick(); };
		const chord = (player: number, code: string) => { button(player, 'select', true); button(player, code, true); tick();
			button(player, code, false); button(player, 'select', false); tick(); };
		const frame = () => { menu.queueRenderCommands(); return queue.consumeHostMenuFrame(); };
		const navigateMove = (player: number) => {
			const last = f.keyboard.rows[f.keyboard.rows.length - 1];
			for (let row = 0; row < f.keyboard.rows.length && !last.keys.includes(f.keyboard.selectedKey); row += 1) press(player, 'down');
			for (let key = 0; key < last.keys.length && f.keyboard.selectedKey !== ON_SCREEN_KEYBOARD_POSITION_TARGET; key += 1) press(player, 'right');
			assert.equal(f.keyboard.selectedKey, ON_SCREEN_KEYBOARD_POSITION_TARGET, 'ordinary D-pad navigation reaches MOVE, without a direct selection mutation');
		};
		tick(); chord(0, 'x');
		assert.equal(f.keyboard.visible, true);
		const original = frame();
		const panel = bitmap ? original.commandRefs[0] as RectRenderSubmission : undefined;
		if (panel) assert.equal(panel.area.top, 4); else assert.equal(original, undefined, 'external presentation publishes no bitmap UI');
		chord(0, 'a'); frame();
		assert.equal(relocations, 0, 'the retired Select+A shortcut no longer relocates any presentation');
		assert.deepEqual(f.writes, [], 'retired chord does not forward a key either');
		for (let page = 0; page < NATIVE_KEYBOARD_PAGES.length; page += 1) {
			assert.equal(f.keyboard.page, page);
			navigateMove(0);
			const before = relocations, revision = f.keyboard.revision;
			button(0, 'a', true); tick(); frame();
			assert.equal(relocations, before + (bitmap ? 1 : 0));
			assert.equal(f.keyboard.revision, revision, 'MOVE dispatch does not create held feedback or keyboard changes');
			if (panel) assert.equal(panel.area.bottom, 208);
			for (let repeat = 0; repeat < 60; repeat += 1) tick();
			assert.equal(relocations, before + (bitmap ? 1 : 0), 'held A cannot repeat MOVE after UI typematic delay');
			button(0, 'a', false); tick();
			assert.equal(f.keyboard.isKeyHighlighted(ON_SCREEN_KEYBOARD_POSITION_TARGET), false);
			press(1, 'a'); frame();
			assert.equal(relocations, before + (bitmap ? 2 : 0), 'another controller may activate the same visible host action independently');
			if (panel) assert.equal(panel.area.top, 4);
			chord(0, 'a'); frame();
			assert.equal(relocations, before + (bitmap ? 2 : 0), 'even focused MOVE requires ordinary A, not the removed Select+A chord');
			if (bitmap) {
				for (let pointerPress = 0; pointerPress < 2; pointerPress += 1) {
					const visible = frame();
					let move: RectRenderSubmission | undefined;
					for (let command = 3; command < visible.commandCount - 8; command += 3) {
						if (visible.commandKinds[command + 2] === Host2DKind.Img
							&& (visible.commandRefs[command + 2] as HostImageRenderSubmission).imgid === 'keyboard_dock_bottom') move = visible.commandRefs[command] as RectRenderSubmission;
					}
					assert.ok(move, 'every native page paints its actual position action');
					f.input.inputAxis2('pointer:0', 'pointer_position', (move.area.left + move.area.right) / 2, (move.area.top + move.area.bottom) / 2, f.clock.now() + 1);
					f.input.inputButton('pointer:0', 'pointer_primary', true, 1, f.clock.now() + 1, ++pressId); tick(); frame();
					assert.equal(relocations, before + 2 + pointerPress, 'pointer DOWN captures the visible dock action without relocating underneath the pointer');
					for (let hold = 0; hold < 5; hold += 1) tick();
					assert.equal(relocations, before + 2 + pointerPress, 'holding the captured dock action cannot activate or repeat it');
					f.input.inputButton('pointer:0', 'pointer_primary', false, 0, f.clock.now() + 1, ++pressId); tick(); frame();
					assert.equal(relocations, before + 3 + pointerPress, 'actual pointer UP activates the exact captured host action once');
				}
				assert.equal(panel.area.top, 4);
			}
			assert.deepEqual(f.writes, [], 'MOVE never creates virtual keyboard source writes');
			chord(0, 'y'); frame();
		}
		assert.equal(f.keyboard.page, 0, 'page cycling retains its existing controller shortcut');
		// Return to an ordinary key only through actual controller navigation.
		press(0, 'down');
		for (let key = 0; key < f.keyboard.rows[0].keys.length && f.keyboard.selectedKey !== 0; key += 1) press(0, 'right');
		assert.equal(f.keyboard.selectedKey, 0);
		for (const [code, forwarded] of [['b', 'Space'], ['x', 'Backspace'], ['lb', 'ArrowLeft'], ['rb', 'ArrowRight'],
			['lt', 'Home'], ['rt', 'End'], ['start', 'Enter']] as const) {
			button(0, code, true); tick(); assert.equal(f.pressed(forwarded), true, `${code} retains ${forwarded}`);
			button(0, code, false); tick(); assert.equal(f.pressed(forwarded), false);
		}
		chord(0, 'x'); assert.equal(f.keyboard.visible, false);
		chord(0, 'x'); frame(); assert.equal(f.keyboard.visible, true);
		if (panel) assert.equal(panel.area.top, 4, 'reopen retains manual presentation position');
		assert.deepEqual(presenter.viewportSize, { x: 256, y: 212 });
	});
}


test('bitmap pointer interaction owns exact keys, real modifier holds and pending dock actions through physical UP', t => {
	const f = fixture(); f.keyboard.close();
	const queue = new HostOverlayQueue();
	const presenter = { viewportSize: { x: 256, y: 212 }, visibleViewportBounds: { left: 0, top: 0, right: 256, bottom: 212 },
		default_font: { lineHeight: 8, measure: (text: string) => text.length * 6 }, hostOverlayQueue: queue,
		mapDisplayPointToViewport(x: number, y: number, point: { x: number; y: number }) { point.x = x; point.y = y; return true; },
	} as VideoPresenter;
	const view = new HostOnScreenKeyboard(presenter, f.keyboard);
	const interaction = new HostKeyboardInteraction(f.input, f.keyboard, presenter, view);
	const menu = new HostOverlayMenu(presenter, {} as Runtime, f.input, {} as HostRewind, createHostFrameFixture().execution, interaction);
	t.after(() => { menu.dismiss(); f.input.dispose(); });
	let pressId = 0, relocations = 0;
	const toggle = view.togglePosition.bind(view);
	view.togglePosition = () => { relocations += 1; toggle(); };
	const tick = () => { f.poll(); menu.tickInput(); f.poll(); };
	const frame = () => { menu.queueRenderCommands(); return queue.consumeHostMenuFrame(); };
	const point = (target: number) => {
		const published = frame();
		let command = 3;
		for (const row of f.keyboard.rows) for (const key of row.keys) {
			const rect = published.commandRefs[command] as RectRenderSubmission; command += 3;
			if (key === target) return { x: (rect.area.left + rect.area.right) / 2, y: (rect.area.top + rect.area.bottom) / 2 };
		}
		assert.fail(`the actual published page must contain target ${target}`);
	};
	const move = (x: number, y: number) => f.input.inputAxis2('pointer:0', 'pointer_position', x, y, f.clock.now() + 1);
	const primary = (down: boolean) => f.input.inputButton('pointer:0', 'pointer_primary', down, down ? 1 : 0, f.clock.now() + 1, ++pressId);
	tick(); menu.requestToggleKeyboard(); tick();
	const q = point(ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyQ')), w = point(ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyW')),
		shift = point(ON_SCREEN_KEY_INDEX_BY_CODE.get('ShiftLeft')), dock = point(ON_SCREEN_KEYBOARD_POSITION_TARGET);
	move(q.x, q.y); primary(true); tick();
	assert.equal(f.pressed('KeyQ'), true);
	move(w.x, w.y); tick();
	assert.equal(f.pressed('KeyQ'), true, 'moving a captured pointer cannot release or retarget its held key');
	assert.equal(f.pressed('KeyW'), false);
	primary(false); tick();
	assert.equal(f.pressed('KeyQ'), false, 'only the actual UP releases the captured key');

	f.keyboard.setPage(KeyboardPage.Functions);
	const functionSelection = f.keyboard.selectedKey;
	move(q.x, q.y); primary(true); tick();
	assert.equal(f.pressed('KeyQ'), true, 'a queued page transition cannot reinterpret the key still painted under a physical DOWN');
	assert.equal(f.keyboard.page, KeyboardPage.Functions); assert.equal(f.keyboard.selectedKey, functionSelection,
		'origin-page pointer selection never replaces current-page controller focus');
	primary(false); tick(); assert.equal(f.pressed('KeyQ'), false);
	f.keyboard.setPage(KeyboardPage.Text); frame();

	move(shift.x, shift.y); primary(true); tick();
	assert.equal(f.pressed('ShiftLeft'), true, 'mouse DOWN is a real held modifier, not an immediate sticky toggle');
	f.input.inputButton('keyboard:0', 'KeyQ', true, 1, f.clock.now() + 1, ++pressId); tick();
	assert.equal(f.pressed('KeyQ'), true); assert.equal(f.pressed('ShiftLeft'), true);
	f.input.inputButton('keyboard:0', 'KeyQ', false, 0, f.clock.now() + 1, pressId); tick();
	primary(false); tick();
	assert.equal(f.pressed('ShiftLeft'), false, 'ordinary hardware typing during the modifier gesture prevents an unused-tap sticky latch');
	primary(true); tick(); primary(false); tick();
	assert.equal(f.pressed('ShiftLeft'), true, 'an unused actual pointer UP still completes the existing sticky modifier tap');
	primary(true); tick(); primary(false); tick();
	assert.equal(f.pressed('ShiftLeft'), false);

	move(dock.x, dock.y); primary(true); tick();
	assert.equal(relocations, 0);
	move(0, 0); tick(); primary(false); tick(); frame();
	assert.equal(relocations, 1, 'capture activates the exact pressed dock action on UP even outside its old footprint');
	const bottomDock = point(ON_SCREEN_KEYBOARD_POSITION_TARGET);
	move(bottomDock.x, bottomDock.y); primary(true); tick();
	menu.dismiss(); primary(false); tick();
	assert.equal(relocations, 1, 'closing the keyboard cancels a pending host action rather than completing a false tap');
});
