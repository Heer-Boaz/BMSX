import assert from 'node:assert/strict';
import test from 'node:test';
import { HostOnScreenKeyboard } from '../../hosts/common/host_on_screen_keyboard';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { OnScreenKeyboardCommand, NATIVE_KEYBOARD_PAGES } from '../../hosts/common/input/on_screen_keyboard_keys';
import { Input } from '../../hosts/common/input/manager';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission, HostImageRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

const SELECTED = 0xff7eb4d9, PRESSED = 0xffffe09a, NORMAL = 0x80bccbdb;
const TEXT = 0xffefefef;
const Q = 15, W = 16, BACKSPACE = 13, SHIFT = 41, CONTROL = 53;

function fixture() {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const queue = new HostOverlayQueue();
	const presenter = {
		viewportSize: { x: 256, y: 192 },
		visibleViewportBounds: { left: 0, top: 0, right: 256, bottom: 192 },
		default_font: { lineHeight: 8, measure: (text: string) => text.length * 6 },
		hostOverlayQueue: queue,
	} as VideoPresenter;
	const keyboard = new OnScreenKeyboard(input, NATIVE_KEYBOARD_PAGES);
	const view = new HostOnScreenKeyboard(presenter, keyboard);
	keyboard.open();
	const snapshot = createInputControllerSnapshot();
	const frame = () => { view.queueRenderCommands(); return queue.consumeHostMenuFrame(); };
	return {
		input, keyboard, presenter, frame,
		key(index: number) {
			const current = frame();
			return {
				edge: (current.commandRefs[3 + index * 3] as RectRenderSubmission).color,
				text: current.commandKinds[5 + index * 3] === Host2DKind.Img
					? (current.commandRefs[5 + index * 3] as HostImageRenderSubmission).colorize
					: (current.commandRefs[5 + index * 3] as GlyphRenderSubmission).color,
			};
		},
		helpColor() { return (frame().commandRefs[189] as GlyphRenderSubmission).color; },
		pressed(code: string) {
			clock.advance(1);
			input.pollInput();
			input.sampleInputControllerSnapshot(snapshot, 0);
			const usage = hidKeyUsageForCode(code);
			return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0;
		},
	};
}

test('selection is visually distinct from a forwarded held key', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	assert.deepEqual(f.key(Q), { edge: SELECTED, text: SELECTED });
	assert.deepEqual(f.key(W), { edge: NORMAL, text: TEXT });
	f.keyboard.updateFeedback(10);
	f.keyboard.activate(0);
	assert.equal(f.pressed('KeyQ'), true);
	assert.deepEqual(f.key(Q), { edge: PRESSED, text: PRESSED });
});

test('120ms release feedback changes presentation only, never the sampled key lifetime', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.updateFeedback(100);
	f.keyboard.activate(0);
	f.keyboard.updateFeedback(110);
	f.keyboard.releaseSource(0);
	assert.equal(f.pressed('KeyQ'), false);
	assert.deepEqual(f.key(Q), { edge: PRESSED, text: PRESSED });
	f.keyboard.updateFeedback(229.9);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.updateFeedback(230);
	assert.deepEqual(f.key(Q), { edge: SELECTED, text: SELECTED });
});

test('long holds stay bright and feedback begins at the actual final release', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.updateFeedback(5000);
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.releaseSource(0);
	f.keyboard.updateFeedback(5119);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.updateFeedback(5120);
	assert.equal(f.key(Q).edge, SELECTED);
});

test('selection movement does not retarget held or released feedback', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.moveHorizontal(1);
	assert.equal(f.key(Q).edge, PRESSED);
	assert.equal(f.key(W).edge, SELECTED);
	f.keyboard.releaseSource(0);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.updateFeedback(120);
	assert.equal(f.key(Q).edge, NORMAL);
	assert.equal(f.key(W).edge, SELECTED);
});

test('different keys have independent held colors and release deadlines', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.command(1, OnScreenKeyboardCommand.Backspace);
	f.keyboard.updateFeedback(10);
	f.keyboard.releaseSource(0);
	f.keyboard.updateFeedback(50);
	f.keyboard.releaseSource(1);
	assert.equal(f.pressed('KeyQ'), false);
	assert.equal(f.pressed('Backspace'), false);
	f.keyboard.updateFeedback(130);
	assert.equal(f.key(Q).edge, SELECTED);
	assert.equal(f.key(BACKSPACE).edge, PRESSED);
	f.keyboard.updateFeedback(170);
	assert.equal(f.key(BACKSPACE).edge, NORMAL);
});

test('another source keeps the shared key bright beyond the first release', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.activate(OnScreenKeyboard.POINTER_SOURCE);
	f.keyboard.releaseSource(0);
	f.keyboard.updateFeedback(1000);
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.releaseSource(OnScreenKeyboard.POINTER_SOURCE);
	assert.equal(f.pressed('KeyQ'), false);
	f.keyboard.updateFeedback(1119);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.updateFeedback(1120);
	assert.equal(f.key(Q).edge, SELECTED);
});

test('repeated presses supersede their old visual release deadline without extending input', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.releaseSource(0);
	f.keyboard.updateFeedback(100);
	f.keyboard.activate(0);
	f.keyboard.updateFeedback(120);
	assert.equal(f.pressed('KeyQ'), true);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.releaseSource(0);
	assert.equal(f.pressed('KeyQ'), false);
	f.keyboard.updateFeedback(239);
	assert.equal(f.key(Q).edge, PRESSED);
	f.keyboard.updateFeedback(240);
	assert.equal(f.key(Q).edge, SELECTED);
});

test('sticky and source-retained modifiers remain visible even when selected', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.command(1, OnScreenKeyboardCommand.Shift);
	assert.equal(f.pressed('ShiftLeft'), true);
	assert.equal(f.key(SHIFT).edge, PRESSED);
	f.keyboard.activate(0);
	f.keyboard.releaseSource(0);
	assert.equal(f.pressed('ShiftLeft'), false);
	assert.equal(f.key(SHIFT).edge, PRESSED);
	f.keyboard.updateFeedback(120);
	assert.equal(f.key(SHIFT).edge, NORMAL);
	for (let row = 0; row < 3; row += 1) f.keyboard.moveVertical(1);
	f.keyboard.moveHorizontal(-1);
	f.keyboard.activate(1);
	assert.deepEqual(f.key(CONTROL), { edge: PRESSED, text: PRESSED });
	f.keyboard.command(0, OnScreenKeyboardCommand.Space);
	f.keyboard.activate(1);
	f.keyboard.updateFeedback(1000);
	assert.equal(f.pressed('ControlLeft'), true);
	assert.equal(f.key(CONTROL).edge, PRESSED);
	f.keyboard.releaseSource(0);
	assert.equal(f.pressed('ControlLeft'), false);
	f.keyboard.updateFeedback(1120);
	assert.deepEqual(f.key(CONTROL), { edge: SELECTED, text: SELECTED });
});

test('Home and End acknowledge forwarding through their existing help legend', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const idle = f.helpColor();
	f.keyboard.command(0, OnScreenKeyboardCommand.Home);
	f.keyboard.command(1, OnScreenKeyboardCommand.End);
	assert.equal(f.helpColor(), PRESSED);
	f.keyboard.releaseSource(0);
	f.keyboard.updateFeedback(500);
	assert.equal(f.helpColor(), PRESSED);
	f.keyboard.releaseSource(1);
	assert.equal(f.pressed('Home'), false);
	assert.equal(f.pressed('End'), false);
	f.keyboard.updateFeedback(620);
	assert.equal(f.helpColor(), idle);
});

test('close cancels visual feedback and reopen cannot resurrect a stale flash', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.activate(0);
	f.keyboard.command(1, OnScreenKeyboardCommand.Backspace);
	f.keyboard.close();
	assert.equal(f.pressed('KeyQ'), false);
	assert.equal(f.key(Q).edge, SELECTED);
	assert.equal(f.key(BACKSPACE).edge, NORMAL);
	f.keyboard.open();
	f.keyboard.updateFeedback(30);
	assert.equal(f.key(Q).edge, SELECTED);
	assert.equal(f.key(BACKSPACE).edge, NORMAL);
});

test('idle feedback ticks and unexpired afterglow reuse commands without rescanning colors', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const before = f.frame();
	const rect = before.commandRefs[3 + Q * 3] as RectRenderSubmission;
	let color = rect.color, writes = 0;
	Object.defineProperty(rect, 'color', { get: () => color, set: value => { color = value; writes += 1; } });
	f.keyboard.updateFeedback(100);
	f.keyboard.updateFeedback(200);
	assert.equal(writes, 0);
	f.keyboard.activate(0);
	f.keyboard.releaseSource(0);
	f.frame();
	writes = 0;
	f.keyboard.updateFeedback(250);
	f.frame();
	assert.equal(writes, 0);
	f.keyboard.updateFeedback(320);
	f.frame();
	assert.equal(writes, 1);
	f.keyboard.updateFeedback(1000);
	assert.equal(writes, 1);
	const after = f.frame();
	assert.equal(after.commandRefs, before.commandRefs);
	assert.equal(after.commandKinds, before.commandKinds);
});


test('Shift released after view construction but before first paint restores base labels and retains MOVE', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.keyboard.pressKey(0, SHIFT);
	assert.equal(f.keyboard.shiftActive, true);
	const view = new HostOnScreenKeyboard(f.presenter, f.keyboard);
	f.keyboard.releaseSource(0);
	assert.equal(f.keyboard.shiftActive, false);
	view.queueRenderCommands();
	const commands = f.presenter.hostOverlayQueue.consumeHostMenuFrame();
	assert.equal((commands.commandRefs[50] as GlyphRenderSubmission).items, 'q');
	assert.equal((commands.commandRefs[49] as GlyphRenderSubmission).items, 'q', 'shadow cannot retain a stale shifted label either');
	assert.equal(commands.commandKinds[185], Host2DKind.Img);
	assert.equal((commands.commandRefs[185] as HostImageRenderSubmission).imgid, 'keyboard_dock_bottom');
});
