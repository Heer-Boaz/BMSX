import assert from 'node:assert/strict';
import test from 'node:test';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { KeyboardPage, OnScreenKeyboardCommand, NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_INDEX_BY_CODE, type OnScreenKeyboardPage } from '../../hosts/common/input/on_screen_keyboard_keys';
import { HostOnScreenKeyboard } from '../../hosts/common/host_on_screen_keyboard';
import { Input } from '../../hosts/common/input/manager';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { Machine } from '../../machine/ts/machine/machine';
import { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_KEYS } from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { cartridgeSlots } from '../helpers/cartridge';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const Q = ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyQ'), W = ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyW');
const SHIFT = ON_SCREEN_KEY_INDEX_BY_CODE.get('ShiftLeft'), CONTROL = ON_SCREEN_KEY_INDEX_BY_CODE.get('ControlLeft');
function fixture(pages: readonly OnScreenKeyboardPage[] = NATIVE_KEYBOARD_PAGES) {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const keyboard = new OnScreenKeyboard(input, pages);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, input, PSX_MACHINE_SPEC); machine.resetDevices();
	let cycle = 0;
	keyboard.open();
	return { input, keyboard, clock, memory,
		poll() { clock.advance(20); input.pollInput(); memory.writeMappedWord(IO_INP_CTRL, INP_CTRL_ARM); machine.inputController.onVblankEdge(++cycle); },
		pressed(code: string) { const usage = hidKeyUsageForCode(code); return (memory.readIoU32(IO_INP_KEYS + (usage >>> 5) * IO_WORD_SIZE) & (1 << (usage & 31))) !== 0; },
	};
}

test('extra contact slots retain independent key lifetimes through real MMIO, including same-key overlap', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const a = f.keyboard.allocateSource(), b = f.keyboard.allocateSource(), c = f.keyboard.allocateSource();
	assert.equal(a, OnScreenKeyboard.INITIAL_SOURCE_COUNT); assert.equal(b, a + 1); assert.equal(c, b + 1);
	f.keyboard.pressKey(a, Q); f.keyboard.pressKey(b, W); f.keyboard.pressKey(c, Q); f.poll();
	assert.equal(f.pressed('KeyQ'), true); assert.equal(f.pressed('KeyW'), true);
	f.keyboard.releaseSource(a); f.poll();
	assert.equal(f.pressed('KeyQ'), true); assert.equal(f.pressed('KeyW'), true);
	f.keyboard.releaseSource(b); f.poll();
	assert.equal(f.pressed('KeyQ'), true); assert.equal(f.pressed('KeyW'), false);
	f.keyboard.releaseSource(c); f.poll(); assert.equal(f.pressed('KeyQ'), false);
});

test('rare high-water growth does not cap contacts or overflow aggregate byte counts', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const sources = Array.from({ length: 300 }, () => f.keyboard.allocateSource());
	for (const source of sources) f.keyboard.pressKey(source, Q);
	f.poll(); assert.equal(f.pressed('KeyQ'), true);
	for (let index = 0; index < sources.length - 1; index += 1) f.keyboard.releaseSource(sources[index]);
	f.poll(); assert.equal(f.pressed('KeyQ'), true);
	f.keyboard.releaseSource(sources.at(-1)); f.poll(); assert.equal(f.pressed('KeyQ'), false);
	f.keyboard.pressKey(sources[0], W); f.poll(); assert.equal(f.pressed('KeyW'), true, 'the native contact owner can reuse its retained source slot');
});

test('physical held modifiers aggregate with other fingers and gamepad latches without one source clearing another', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const shiftA = f.keyboard.allocateSource(), shiftB = f.keyboard.allocateSource(), letter = f.keyboard.allocateSource();
	f.keyboard.pressKey(shiftA, SHIFT); f.keyboard.pressKey(shiftB, SHIFT); f.keyboard.pressKey(letter, Q); f.poll();
	assert.equal(f.pressed('ShiftLeft'), true); assert.equal(f.pressed('KeyQ'), true); assert.equal(f.keyboard.label(Q), 'Q');
	f.keyboard.releaseSource(shiftA); f.poll(); assert.equal(f.pressed('ShiftLeft'), true);
	f.keyboard.releaseSource(shiftB); f.poll();
	assert.equal(f.pressed('ShiftLeft'), false, 'physical Shift up is immediate while Q remains physically held');
	assert.equal(f.pressed('KeyQ'), true); assert.equal(f.keyboard.label(Q), 'q');
	f.keyboard.releaseSource(letter);
	f.keyboard.activateKey(0, CONTROL); f.keyboard.pressKey(shiftA, CONTROL); f.keyboard.pressKey(letter, Q);
	f.keyboard.activateKey(0, CONTROL); f.keyboard.releaseSource(shiftA); f.poll();
	assert.equal(f.pressed('ControlLeft'), true, 'a captured latch still owns CTRL after direct-contact up and latch toggle');
	f.keyboard.releaseSource(letter); f.poll(); assert.equal(f.pressed('ControlLeft'), false);
	f.keyboard.activateKey(0, SHIFT); f.keyboard.pressKey(shiftA, SHIFT); f.keyboard.pressKey(letter, W);
	f.keyboard.releaseSource(letter); f.poll(); assert.equal(f.pressed('ShiftLeft'), true, 'one-shot latch completion cannot release physical Shift');
	f.keyboard.releaseSource(shiftA); f.poll(); assert.equal(f.pressed('ShiftLeft'), false);
});

test('source retargeting publishes the real old release/new press and repeated same-key updates cannot leak a hold', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const source = f.keyboard.allocateSource();
	f.keyboard.pressKey(source, Q); f.keyboard.pressKey(source, Q); f.keyboard.pressKey(source, W); f.poll();
	assert.equal(f.pressed('KeyQ'), false); assert.equal(f.pressed('KeyW'), true);
	f.keyboard.releaseSource(source); f.poll(); assert.equal(f.pressed('KeyW'), false);
});

test('F1-F12 identities, injected page navigation and held-source page switching reach real MMIO', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const text = f.keyboard.allocateSource(), fn = f.keyboard.allocateSource();
	f.keyboard.pressKey(text, Q); f.keyboard.setPage(KeyboardPage.Functions);
	assert.equal(f.keyboard.selectedKey, ON_SCREEN_KEY_INDEX_BY_CODE.get('F1'));
	f.keyboard.moveHorizontal(-1); assert.equal(f.keyboard.selectedKey, ON_SCREEN_KEY_INDEX_BY_CODE.get('F6'));
	f.keyboard.moveVertical(1); assert.equal(f.keyboard.selectedKey, ON_SCREEN_KEY_INDEX_BY_CODE.get('F12'));
	f.keyboard.activate(fn); f.poll(); assert.equal(f.pressed('F12'), true); assert.equal(f.pressed('KeyQ'), true);
	f.keyboard.setPage(KeyboardPage.Text); f.poll(); assert.equal(f.pressed('F12'), true, 'changing page never fabricates a contact release');
	f.keyboard.releaseSource(fn); f.poll(); assert.equal(f.pressed('F12'), false); assert.equal(f.pressed('KeyQ'), true);
	for (let index = 1; index <= 12; index += 1) {
		f.keyboard.pressKey(fn, ON_SCREEN_KEY_INDEX_BY_CODE.get(`F${index}`)); f.poll(); assert.equal(f.pressed(`F${index}`), true);
		f.keyboard.releaseSource(fn); f.poll(); assert.equal(f.pressed(`F${index}`), false);
	}
	f.keyboard.close(); f.poll(); assert.equal(f.pressed('KeyQ'), false);
});

test('navigation follows the active presentation centered rows and fractional widths, not the old bitmap order', t => {
	const pages: readonly OnScreenKeyboardPage[] = [{ initialKey: Q, rows: [
		{ keys: [Q, W], starts: [0, 1], spans: [1, 1], units: 2 },
		{ keys: [SHIFT], starts: [0], spans: [1.5], units: 1.5 },
	] }, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]];
	const f = fixture(pages); t.after(() => f.input.dispose());
	f.keyboard.moveHorizontal(1); assert.equal(f.keyboard.selectedKey, W);
	f.keyboard.moveVertical(1); assert.equal(f.keyboard.selectedKey, SHIFT);
	f.keyboard.moveVertical(-1); assert.equal(f.keyboard.selectedKey, Q, 'a centered tie follows the authored left-first key order');
	f.keyboard.setPage(KeyboardPage.Functions); f.keyboard.selectKey(73);
	f.keyboard.setPage(KeyboardPage.Text); assert.equal(f.keyboard.selectedKey, Q);
	f.keyboard.setPage(KeyboardPage.Functions); assert.equal(f.keyboard.selectedKey, 73, 'each visible page retains its real selection');
});

test('explicit row starts preserve arrow gaps in navigation, bitmap drawing and hit testing', t => {
	const UP = ON_SCREEN_KEY_INDEX_BY_CODE.get('ArrowUp'), DOWN = ON_SCREEN_KEY_INDEX_BY_CODE.get('ArrowDown');
	const LEFT = ON_SCREEN_KEY_INDEX_BY_CODE.get('ArrowLeft'), RIGHT = ON_SCREEN_KEY_INDEX_BY_CODE.get('ArrowRight');
	const pages: readonly OnScreenKeyboardPage[] = [{ initialKey: UP, rows: [
		{ keys: [Q, UP, W], starts: [0, 3, 5], spans: [1, 1, 1], units: 6 },
		{ keys: [CONTROL, LEFT, DOWN, RIGHT, 55], starts: [0, 2, 3, 4, 5], spans: [1, 1, 1, 1, 1], units: 6 },
	] }, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]];
	const f = fixture(pages); t.after(() => f.input.dispose());
	f.keyboard.moveVertical(1); assert.equal(f.keyboard.selectedKey, DOWN, 'Up aligns directly over Down, not the compressed second-column Left');
	f.keyboard.moveVertical(-1); assert.equal(f.keyboard.selectedKey, UP);
	f.keyboard.moveHorizontal(1); assert.equal(f.keyboard.selectedKey, W, 'a non-key gap cannot become controller selection');
	f.keyboard.moveHorizontal(1); assert.equal(f.keyboard.selectedKey, Q, 'horizontal wrap follows only authored key identities');
	f.keyboard.moveHorizontal(-1); assert.equal(f.keyboard.selectedKey, W);
	const { presenter, queue } = createHostOverlayFixture(256, 192); presenter.default_font = new Font();
	const view = new HostOnScreenKeyboard(presenter, f.keyboard); view.queueRenderCommands();
	const frame = queue.consumeHostMenuFrame();
	const qRect = (frame.commandRefs[2] as RectRenderSubmission).area;
	const upRect = (frame.commandRefs[4] as RectRenderSubmission).area;
	const downRect = (frame.commandRefs[12] as RectRenderSubmission).area;
	assert.equal(upRect.left - qRect.left, 3 * (qRect.right - qRect.left + 1));
	assert.equal(upRect.left, downRect.left, 'bitmap arrow hit rectangles use the same authored column');
	assert.equal(view.selectAt((upRect.left + upRect.right) / 2, (upRect.top + upRect.bottom) / 2), UP);
	const gapX = qRect.right + (qRect.right - qRect.left) / 2;
	assert.equal(view.selectAt(gapX, (qRect.top + qRect.bottom) / 2), -1, 'reserved command space does not acquire an unrelated physical key');
	assert.equal(view.containsPoint(gapX, (qRect.top + qRect.bottom) / 2), false);
});

test('native row starts retain the existing contiguous physical keyboard geometry', () => {
	for (const page of NATIVE_KEYBOARD_PAGES) for (const row of page.rows) {
		assert.equal(row.starts.length, row.keys.length);
		assert.equal(row.spans.length, row.keys.length);
		let units = 0;
		for (let column = 0; column < row.keys.length; column += 1) {
			assert.equal(row.starts[column], units);
			units += row.spans[column];
		}
		assert.equal(units, row.units);
	}
});

test('two authored pages cycle independently of native page names and retain real key sources', t => {
	const pages = [NATIVE_KEYBOARD_PAGES[0], NATIVE_KEYBOARD_PAGES[2]];
	const f = fixture(pages); t.after(() => f.input.dispose());
	const textSource = f.keyboard.allocateSource(), functionSource = f.keyboard.allocateSource(), shiftSource = f.keyboard.allocateSource();
	f.keyboard.pressKey(shiftSource, SHIFT); f.keyboard.pressKey(textSource, Q); f.keyboard.selectKey(W);
	f.keyboard.command(0, OnScreenKeyboardCommand.TogglePage);
	assert.equal(f.keyboard.page, 1); assert.equal(f.keyboard.selectedKey, 62);
	f.keyboard.pressKey(functionSource, 62); f.keyboard.selectKey(63);
	f.keyboard.command(0, OnScreenKeyboardCommand.TogglePage); f.poll();
	assert.equal(f.keyboard.page, 0); assert.equal(f.keyboard.selectedKey, W, 'the main page restores its own selected key');
	assert.equal(f.pressed('KeyQ'), true); assert.equal(f.pressed('F1'), true); assert.equal(f.pressed('ShiftLeft'), true);
	f.keyboard.command(0, OnScreenKeyboardCommand.TogglePage);
	assert.equal(f.keyboard.page, 1); assert.equal(f.keyboard.selectedKey, 63, 'the auxiliary page restores its own selected key');
	f.keyboard.releaseSource(textSource); f.poll();
	assert.equal(f.pressed('KeyQ'), false); assert.equal(f.pressed('F1'), true); assert.equal(f.pressed('ShiftLeft'), true);
	f.keyboard.releaseSource(functionSource); f.keyboard.releaseSource(shiftSource); f.poll();
	assert.equal(f.pressed('F1'), false); assert.equal(f.pressed('ShiftLeft'), false);
	f.keyboard.close(); f.keyboard.open();
	assert.equal(f.keyboard.page, 0); assert.equal(f.keyboard.selectedKey, pages[0].initialKey);
});

test('revision observers cover visibility, held/latched state, selection, pages and afterglow without idle churn', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	let changes = 0; const dispose = f.keyboard.subscribe(() => changes++);
	f.keyboard.updateFeedback(10); assert.equal(changes, 0);
	f.keyboard.selectKey(W); f.keyboard.pressKey(0, W); f.keyboard.releaseSource(0);
	assert.equal(changes, 3); assert.equal(f.keyboard.isKeyHighlighted(W), true);
	f.keyboard.updateFeedback(129); assert.equal(changes, 3);
	f.keyboard.updateFeedback(130); assert.equal(changes, 4); assert.equal(f.keyboard.isKeyHighlighted(W), false);
	f.keyboard.setPage(KeyboardPage.Functions); assert.equal(changes, 5);
	f.keyboard.close(); assert.equal(changes, 6); assert.equal(f.keyboard.visible, false);
	f.keyboard.open(); assert.equal(changes, 7); assert.equal(f.keyboard.visible, true);
	dispose(); f.keyboard.selectKey(W); assert.equal(changes, 7);
});

test('bitmap consumer renders/hits every function-page key from the same actual logical keyboard identities', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const { presenter, queue } = createHostOverlayFixture(256, 192); presenter.default_font = new Font();
	const view = new HostOnScreenKeyboard(presenter, f.keyboard);
	f.keyboard.setPage(KeyboardPage.Functions); view.queueRenderCommands();
	const frame = queue.consumeHostMenuFrame();
	assert.equal((frame.commandRefs[1] as GlyphRenderSubmission).items, 'KEYBOARD: FN');
	let command = 2;
	for (const row of f.keyboard.rows) for (const key of row.keys) {
		assert.equal(frame.commandKinds[command], Host2DKind.Rect);
		const rect = frame.commandRefs[command++] as RectRenderSubmission;
		assert.equal(frame.commandKinds[command], Host2DKind.Glyphs);
		const glyph = frame.commandRefs[command++] as GlyphRenderSubmission;
		assert.equal(glyph.items, f.keyboard.label(key));
		assert.equal(view.selectAt((rect.area.left + rect.area.right) / 2, (rect.area.top + rect.area.bottom) / 2), key);
		assert.equal(f.keyboard.selectedKey, key);
	}
	assert.equal(frame.commandCount, command + 4);
	assert.equal((frame.commandRefs[command + 2] as GlyphRenderSubmission).items, 'START ENTER  SEL+B DEL  SEL+Y PAGE');
	f.keyboard.setPage(KeyboardPage.Symbols); view.queueRenderCommands();
	assert.equal((queue.consumeHostMenuFrame().commandRefs[1] as GlyphRenderSubmission).items, 'KEYBOARD: SYMBOLS');
});

test('unused modifier tap completion observes ordinary keys from every source, including gamepad activation', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const touch = f.keyboard.allocateSource();
	f.keyboard.pressKey(touch, SHIFT); f.keyboard.selectKey(Q); f.keyboard.activate(0); f.poll();
	assert.equal(f.pressed('ShiftLeft'), true); assert.equal(f.pressed('KeyQ'), true);
	f.keyboard.releaseSource(0); f.keyboard.releaseSource(touch, true); f.poll();
	assert.equal(f.pressed('KeyQ'), false); assert.equal(f.pressed('ShiftLeft'), false, 'a completed controller chord never becomes a sticky modifier tap');
	f.keyboard.pressKey(0, W); f.keyboard.pressKey(touch, SHIFT); f.keyboard.releaseSource(0);
	f.keyboard.releaseSource(touch, true); f.poll();
	assert.equal(f.pressed('ShiftLeft'), false, 'a modifier begun during an already-held ordinary key is also a chord');
	f.keyboard.pressKey(touch, SHIFT); f.keyboard.releaseSource(touch, false); f.poll();
	assert.equal(f.pressed('ShiftLeft'), false, 'native cancel cannot complete a tap');
	f.keyboard.pressKey(touch, SHIFT); f.keyboard.releaseSource(touch, true); f.poll();
	assert.equal(f.pressed('ShiftLeft'), true, 'an unused actual modifier UP completes its sticky tap');
	f.keyboard.pressKey(touch, SHIFT); f.keyboard.releaseSource(touch, true); f.poll();
	assert.equal(f.pressed('ShiftLeft'), false, 'a second unused tap toggles the same latch off');
	f.keyboard.pressKey(touch, SHIFT); f.keyboard.close(); f.poll();
	assert.equal(f.pressed('ShiftLeft'), false, 'closing releases physical sources without completing taps');
});

test('retained observer slots permit self-unsubscribe and old disposers cannot retire reused subscriptions', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	let first = 0, second = 0, reused = 0;
	const disposeFirst = f.keyboard.subscribe(() => { first++; disposeFirst(); });
	const disposeSecond = f.keyboard.subscribe(() => { second++; });
	f.keyboard.selectKey(W); assert.equal(first, 1); assert.equal(second, 1);
	const disposeReused = f.keyboard.subscribe(() => { reused++; });
	disposeFirst(); f.keyboard.selectKey(Q);
	assert.equal(first, 1); assert.equal(second, 2); assert.equal(reused, 1);
	disposeSecond(); disposeReused(); f.keyboard.selectKey(W);
	assert.equal(second, 2); assert.equal(reused, 1);
});

test('fractional injected centers stay fractional throughout directional navigation', t => {
	const pages: readonly OnScreenKeyboardPage[] = [{ initialKey: W, rows: [
		{ keys: [Q, W, 17], starts: [0, 1.6, 2.2], spans: [1.6, 0.6, 1.4], units: 3.6 },
		{ keys: [SHIFT, CONTROL, 54, 55], starts: [0, 1.35, 1.75, 2.25], spans: [1.35, 0.4, 0.5, 1.35], units: 3.6 },
	] }, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]];
	const f = fixture(pages); t.after(() => f.input.dispose());
	f.keyboard.moveVertical(1); assert.equal(f.keyboard.selectedKey, 54, '3.8-unit W is closer to 4.0-unit ALT than 3.1-unit CTRL; truncation would incorrectly select CTRL');
});

test('queued origin-page key targets preserve active page navigation in both native batch orders', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const contact = f.keyboard.allocateSource();
	for (const pageFirst of [true, false]) {
		f.keyboard.open();
		if (pageFirst) f.keyboard.setPage(KeyboardPage.Functions);
		f.keyboard.selectKey(W, KeyboardPage.Text); f.keyboard.pressKey(contact, W);
		if (!pageFirst) f.keyboard.setPage(KeyboardPage.Functions);
		f.poll();
		assert.equal(f.keyboard.page, KeyboardPage.Functions);
		assert.equal(f.keyboard.selectedKey, 62, 'old Text key origin cannot become an invalid function-row selection');
		assert.equal(f.pressed('KeyW'), true, 'the real queued old-page contact still presses its original physical key');
		f.keyboard.moveHorizontal(1); assert.equal(f.keyboard.selectedKey, 63);
		f.keyboard.setPage(KeyboardPage.Text); assert.equal(f.keyboard.selectedKey, W, 'origin-page selection is retained for the genuine Text page');
		f.keyboard.releaseSource(contact); f.poll(); assert.equal(f.pressed('KeyW'), false);
	}
});
