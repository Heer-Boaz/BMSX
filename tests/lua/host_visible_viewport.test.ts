import assert from 'node:assert/strict';
import test from 'node:test';
import { HostOnScreenKeyboard } from '../../hosts/common/host_on_screen_keyboard';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES } from '../../hosts/common/input/on_screen_keyboard_keys';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function assertVisible(frame: HostMenuFrame, bounds: Readonly<RectBounds>): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] === Host2DKind.Rect) {
			const { area } = frame.commandRefs[index] as RectRenderSubmission;
			assert.ok(area.left >= bounds.left && area.right <= bounds.right, `rect ${index} stays horizontally visible`);
			assert.ok(area.top >= bounds.top && area.bottom <= bounds.bottom, `rect ${index} stays vertically visible`);
		} else if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const glyph = frame.commandRefs[index] as GlyphRenderSubmission;
			const text = (glyph.items as string).slice(glyph.item_start, glyph.item_end);
			assert.ok(glyph.x >= bounds.left && glyph.x + glyph.font!.measure(text) <= bounds.right, `glyph ${index} '${text}' stays horizontally visible`);
			assert.ok(glyph.y >= bounds.top && glyph.y + glyph.font!.lineHeight <= bounds.bottom, `glyph ${index} '${text}' stays vertically visible`);
		}
	}
}

function keyboardFixture() {
	const { output, presenter, queue } = createHostOverlayFixture(256, 192);
	presenter.default_font = new Font();
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const model = new OnScreenKeyboard(input, NATIVE_KEYBOARD_PAGES);
	const keyboard = new HostOnScreenKeyboard(presenter, model);
	model.open();
	const frame = () => { keyboard.queueRenderCommands(); return queue.consumeHostMenuFrame(); };
	return { output, presenter, input, keyboard, frame };
}

test('video presenter retains its producer visible rectangle without changing full-image mapping', () => {
	const { output, presenter } = createHostOverlayFixture(256, 192);
	const bounds = output.visibleViewportBounds;
	assert.equal(presenter.visibleViewportBounds, bounds);
	write_rect_bounds(bounds, 12.8, 9.6, 243.2, 182.4);
	const point = { x: 0, y: 0 };
	assert.equal(presenter.mapDisplayPointToViewport(128, 96, point), true);
	assert.deepEqual(point, { x: 128, y: 96 });
	assert.deepEqual(presenter.viewportSize, { x: 256, y: 192 });
	output.setDisplaySize(320, 240);
	assert.equal(presenter.visibleViewportBounds, bounds);
	assert.deepEqual(bounds, { left: 0, top: 0, right: 320, bottom: 240 });
});

test('real keyboard panel, glyphs, help and every interactive key fit the 5%-cropped native 256×192 surface', t => {
	const f = keyboardFixture(); t.after(() => f.input.dispose());
	const normal = f.frame();
	const panel = normal.commandRefs[0] as RectRenderSubmission;
	const q = normal.commandRefs[32] as RectRenderSubmission;
	assert.equal(panel.area.right - panel.area.left, 231);
	assert.equal(panel.area.top, f.output.visibleViewportBounds.top + 4, 'the real panel docks to the visible picture top');
	assert.equal(q.area.right - q.area.left, 13);
	assertVisible(normal, f.presenter.visibleViewportBounds);
	write_rect_bounds(f.output.visibleViewportBounds, 12.8, 9.6, 243.2, 182.4);
	const cropped = f.frame();
	assert.equal(cropped.commandRefs[0], panel);
	assert.equal(cropped.commandRefs[32], q);
	assert.equal(panel.area.right - panel.area.left, 215);
	assert.equal(panel.area.top, f.output.visibleViewportBounds.top + 4, 'cropping changes the owner anchor, not input priority');
	assert.equal(q.area.right - q.area.left, 12);
	assertVisible(cropped, f.presenter.visibleViewportBounds);
	for (let key = 0; key < 60; key += 1) {
		const rect = cropped.commandRefs[2 + key * 2] as RectRenderSubmission;
		const x = (rect.area.left + rect.area.right) / 2, y = (rect.area.top + rect.area.bottom) / 2;
		assert.equal(f.keyboard.containsPoint(x, y), true);
		assert.equal(f.keyboard.selectAt(x, y), key);
	}
	assert.equal(f.keyboard.containsPoint(0, 0), false);
	assert.equal(f.keyboard.selectAt(0, 0), -1);
});

test('keyboard relayouts on visible origin changes and reuses its real commands without repeated font measurement', t => {
	const f = keyboardFixture(); t.after(() => f.input.dispose());
	write_rect_bounds(f.output.visibleViewportBounds, 12.8, 9.6, 243.2, 182.4);
	const key = f.frame().commandRefs[32] as RectRenderSubmission;
	const oldLeft = key.area.left, oldTop = key.area.top;
	const font = f.presenter.default_font;
	const measure = font.measure.bind(font);
	let measurements = 0;
	font.measure = text => { measurements += 1; return measure(text); };
	f.frame(); f.frame();
	assert.equal(measurements, 0);
	f.output.visibleViewportBounds.bottom -= 10;
	assert.equal(f.frame().commandRefs[32], key);
	assert.equal(key.area.top, oldTop);
	assert.equal(key.area.left, oldLeft);
	assert.equal(measurements, 0, 'top-docked geometry does not depend on the picture bottom');
	assert.equal(f.keyboard.selectAt((key.area.left + key.area.right) / 2, (key.area.top + key.area.bottom) / 2), 15);
	write_rect_bounds(f.output.visibleViewportBounds, 14.8, 12.6, 245.2, 185.4);
	assert.equal(f.frame().commandRefs[32], key);
	assert.equal(key.area.left, oldLeft + 2);
	assert.equal(key.area.top, oldTop + 3);
	assert.ok(measurements > 0);
	measurements = 0;
	f.frame();
	assert.equal(measurements, 0);
});

test('host menu uses a selected visible row window and maps pointer activation through its first-row offset', t => {
	const host = createHostFrameFixture(); t.after(() => host.input.dispose());
	const { output, presenter, queue } = createHostOverlayFixture(256, 192);
	const font = new Font(); presenter.default_font = font;
	write_rect_bounds(output.visibleViewportBounds, 12.8, 9.6, 243.2, 182.4);
	let picture = 0;
	const menu = new HostOverlayMenu(presenter, host.runtime, host.input, host.rewind, host.execution, [{
		kind: 'value', label: 'PICTURE', values: [{ label: 'FIT' }, { label: 'OVERSCAN' }],
		getIndex: () => picture, setIndex: value => { picture = value; },
	}]);
	let time = 10, pressId = 1;
	const tick = () => { host.input.pollInput(); return menu.tickInput(); };
	const key = (code: string, down: boolean) => host.input.inputButton('keyboard:0', code, down, down ? 1 : 0, time++, pressId++);
	key('ControlRight', true); key('AltRight', true);
	assert.equal(tick(), HostMenuInput.Active);
	key('ControlRight', false); key('AltRight', false); tick();
	const frame = () => { menu.queueRenderCommands(); return queue.consumeHostMenuFrame(); };
	const first = frame();
	assertVisible(first, presenter.visibleViewportBounds);
	assert.equal((first.commandRefs[1] as GlyphRenderSubmission).items, 'CORE OPTIONS [1-18/20]');
	assert.equal(first.commandCount, 21);
	assert.deepEqual(presenter.viewportSize, { x: 256, y: 192 });
	const measure = font.measure.bind(font);
	let measurements = 0;
	font.measure = text => { measurements += 1; return measure(text); };
	frame(); frame();
	assert.equal(measurements, 0, 'unchanged menu frames do not remeasure all row strings');
	key('ArrowUp', true); tick(); key('ArrowUp', false); tick();
	const last = frame();
	assertVisible(last, presenter.visibleViewportBounds);
	assert.equal((last.commandRefs[1] as GlyphRenderSubmission).items, 'CORE OPTIONS [3-20/20]');
	const firstRow = last.commandRefs[2] as GlyphRenderSubmission;
	assert.equal(firstRow.items, 'CRT Noise  ON');
	host.input.inputAxis2('pointer:0', 'pointer_position', firstRow.x + 3, firstRow.y + 3, time++);
	host.input.inputButton('pointer:0', 'pointer_primary', true, 1, time++, pressId++);
	assert.equal(tick(), HostMenuInput.Active);
	host.input.inputButton('pointer:0', 'pointer_primary', false, 0, time++, pressId++); tick();
	assert.equal(presenter.enable_noise, false, 'first painted row maps to global option2, not option0');
	assert.equal(presenter.show_resource_usage_gizmo, false);
	assertVisible(frame(), presenter.visibleViewportBounds);
});

test('closed-menu FPS and usage HUD translate within retained safe bounds without shifting the game target', t => {
	const host = createHostFrameFixture(); t.after(() => host.input.dispose());
	const { output, presenter, queue } = createHostOverlayFixture(256, 192);
	presenter.default_font = new Font();
	write_rect_bounds(output.visibleViewportBounds, 12.8, 9.6, 243.2, 182.4);
	presenter.show_resource_usage_gizmo = true;
	const menu = new HostOverlayMenu(presenter, host.runtime, host.input, host.rewind, host.execution);
	let time = 10, pressId = 1;
	const tick = () => { host.input.pollInput(); menu.tickInput(); };
	const key = (code: string, down: boolean) => host.input.inputButton('keyboard:0', code, down, down ? 1 : 0, time++, pressId++);
	key('ControlRight', true); key('AltRight', true); tick();
	key('ControlRight', false); key('AltRight', false); tick();
	for (let index = 0; index < 10; index += 1) {
		key('ArrowDown', true); tick(); key('ArrowDown', false); tick();
	}
	key('ArrowRight', true); tick(); key('ArrowRight', false); tick();
	key('Escape', true); tick(); key('Escape', false); tick();
	assert.equal(menu.queueFrameOverlayCommands(60), true);
	const frame = queue.consumeHostMenuFrame();
	assertVisible(frame, presenter.visibleViewportBounds);
	const fps = frame.commandRefs[0] as GlyphRenderSubmission;
	assert.equal(fps.items, 'HOST: 60.0');
	assert.equal(fps.x + presenter.default_font.measure('HOST: 60.0'), output.visibleViewportBounds.right - 8);
	assert.equal(fps.y, output.visibleViewportBounds.top + 8);
	const panel = frame.commandRefs[1] as RectRenderSubmission;
	assert.equal(panel.area.left, 16.8);
	assert.equal(panel.area.top, 9.6 + 8 - 4);
	const fillIndex = frame.commandKinds.findIndex((kind, index) => index < frame.commandCount
		&& kind === Host2DKind.Rect && (frame.commandRefs[index] as RectRenderSubmission).color === 0xffff5134);
	assert.ok(fillIndex >= 0, 'full VRAM usage publishes its actual filled bar');
	const fill = frame.commandRefs[fillIndex] as RectRenderSubmission;
	assert.equal(fill.area.right, fill.area.left + 54);
	write_rect_bounds(output.visibleViewportBounds, 14.8, 12.6, 245.2, 185.4);
	menu.queueFrameOverlayCommands(60);
	const translated = queue.consumeHostMenuFrame();
	assert.equal(translated.commandRefs[1], panel);
	assert.equal(panel.area.left, 18.8);
	assert.equal(panel.area.top, 16.6);
	assertVisible(translated, presenter.visibleViewportBounds);
	assert.deepEqual(presenter.viewportSize, { x: 256, y: 192 });
});
