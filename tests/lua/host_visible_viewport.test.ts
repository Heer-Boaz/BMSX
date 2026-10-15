import assert from 'node:assert/strict';
import test from 'node:test';
import { HostOnScreenKeyboard } from '../../hosts/common/host_on_screen_keyboard';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { KeyboardPage, OnScreenKeyboardCommand, ON_SCREEN_KEYBOARD_POSITION_TARGET, NATIVE_KEYBOARD_PAGES } from '../../hosts/common/input/on_screen_keyboard_keys';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import { hostSystemAtlasImage } from '../../machine/ts/render/host_overlay/atlas';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { RectRenderKind, type GlyphRenderSubmission, type HostImageRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function assertVisible(frame: HostMenuFrame, bounds: Readonly<RectBounds>): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] === Host2DKind.Rect) {
			const { area } = frame.commandRefs[index] as RectRenderSubmission;
			assert.ok(area.left >= bounds.left && area.right <= bounds.right, `rect ${index} stays horizontally visible`);
			assert.ok(area.top >= bounds.top && area.bottom <= bounds.bottom, `rect ${index} stays vertically visible`);
		} else if (frame.commandKinds[index] === Host2DKind.Img) {
			const image = frame.commandRefs[index] as HostImageRenderSubmission, source = hostSystemAtlasImage(image.imgid);
			assert.ok(image.pos.x >= bounds.left && image.pos.x + source.width <= bounds.right, `image ${image.imgid} stays horizontally visible`);
			assert.ok(image.pos.y >= bounds.top && image.pos.y + source.height <= bounds.bottom, `image ${image.imgid} stays vertically visible`);
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
	return { output, presenter, input, model, keyboard, frame };
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
	const q = normal.commandRefs[48] as RectRenderSubmission;
	assert.equal(panel.area.right - panel.area.left, 231);
	assert.equal(panel.area.top, f.output.visibleViewportBounds.top + 4, 'the real panel docks to the visible picture top');
	assert.equal(q.area.right - q.area.left, 13);
	assertVisible(normal, f.presenter.visibleViewportBounds);
	write_rect_bounds(f.output.visibleViewportBounds, 12.8, 9.6, 243.2, 182.4);
	const cropped = f.frame();
	assert.equal(cropped.commandRefs[0], panel);
	assert.equal(cropped.commandRefs[48], q);
	assert.equal(panel.area.right - panel.area.left, 215);
	assert.equal(panel.area.top, f.output.visibleViewportBounds.top + 4, 'cropping changes the owner anchor, not input priority');
	assert.equal(q.area.right - q.area.left, 12);
	assertVisible(cropped, f.presenter.visibleViewportBounds);
	for (let index = 0; index < 61; index += 1) {
		const key = index === 60 ? ON_SCREEN_KEYBOARD_POSITION_TARGET : index;
		const rect = cropped.commandRefs[3 + index * 3] as RectRenderSubmission;
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
	const key = f.frame().commandRefs[48] as RectRenderSubmission;
	const oldLeft = key.area.left, oldTop = key.area.top;
	const font = f.presenter.default_font;
	const measure = font.measure.bind(font);
	let measurements = 0;
	font.measure = text => { measurements += 1; return measure(text); };
	f.frame(); f.frame();
	assert.equal(measurements, 0);
	f.output.visibleViewportBounds.bottom -= 10;
	assert.equal(f.frame().commandRefs[48], key);
	assert.equal(key.area.top, oldTop);
	assert.equal(key.area.left, oldLeft);
	assert.ok(measurements > 0, 'retained bounds include bottom because either docking position can depend on it');
	assert.equal(f.keyboard.selectAt((key.area.left + key.area.right) / 2, (key.area.top + key.area.bottom) / 2), 15);
	write_rect_bounds(f.output.visibleViewportBounds, 14.8, 12.6, 245.2, 185.4);
	assert.equal(f.frame().commandRefs[48], key);
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


test('native bitmap keyboard keeps every panel and key surface open, with retained one-pixel glyph shadows on all pages', t => {
	const f = keyboardFixture(); t.after(() => f.input.dispose());
	for (const page of [KeyboardPage.Text, KeyboardPage.Symbols, KeyboardPage.Functions]) {
		f.model.setPage(page);
		const frame = f.frame();
		const keys = f.model.rows.reduce((count, row) => count + row.keys.length, 0);
		assert.equal(frame.commandCount, 3 + keys * 3 + 4 * 2);
		assert.equal((frame.commandRefs[0] as RectRenderSubmission).color, 0x60465264);
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] === Host2DKind.Rect) {
				assert.equal((frame.commandRefs[index] as RectRenderSubmission).kind, RectRenderKind.Rect, 'no filled panel or key can obscure the game');
			} else if (frame.commandKinds[index] === Host2DKind.Img) {
				const shadow = frame.commandRefs[index++] as HostImageRenderSubmission;
				assert.equal(frame.commandKinds[index], Host2DKind.Img);
				const icon = frame.commandRefs[index] as HostImageRenderSubmission;
				assert.equal(shadow.imgid, icon.imgid); assert.equal(shadow.colorize, 0xff080c12);
				assert.equal(shadow.pos.x, icon.pos.x + 1); assert.equal(shadow.pos.y, icon.pos.y + 1);
			} else {
				const shadow = frame.commandRefs[index++] as GlyphRenderSubmission;
				const glyph = frame.commandRefs[index] as GlyphRenderSubmission;
				assert.equal(shadow.color, 0xff080c12);
				assert.equal(shadow.items, glyph.items);
				assert.equal(shadow.x, glyph.x + 1); assert.equal(shadow.y, glyph.y + 1);
				assert.equal(shadow.has_background_color, false); assert.equal(glyph.has_background_color, false);
			}
		}
		assertVisible(frame, f.presenter.visibleViewportBounds);
	}
});

test('manual native keyboard docking preserves model ownership and follows live bounds, page sizes and Shift labels', t => {
	const f = keyboardFixture(); t.after(() => f.input.dispose());
	write_rect_bounds(f.output.visibleViewportBounds, 12.8, 9.6, 243.2, 182.4);
	const original = f.frame(), panel = original.commandRefs[0] as RectRenderSubmission;
	const q = original.commandRefs[48] as RectRenderSubmission, glyph = original.commandRefs[50] as GlyphRenderSubmission;
	const top = panel.area.top, height = panel.area.bottom - panel.area.top;
	const previousQ = { ...q.area }, heldKey = 15;
	f.model.pressKey(0, heldKey);
	const heldRevision = f.model.revision;
	f.keyboard.togglePosition();
	const bottom = f.frame();
	assert.equal(f.model.revision, heldRevision, 'docking does not mutate key state, selection or feedback');
	assert.equal(f.model.isKeyPressed(heldKey), true);
	assert.equal(bottom.commandRefs, original.commandRefs); assert.equal(bottom.commandKinds, original.commandKinds);
	assert.equal(bottom.commandRefs[0], panel); assert.equal(bottom.commandRefs[48], q);
	assert.equal(panel.area.bottom, f.output.visibleViewportBounds.bottom - 4);
	assert.equal(panel.area.top, f.output.visibleViewportBounds.bottom - 4 - height);
	assert.notEqual(q.area.top, previousQ.top);
	assert.equal(f.keyboard.selectAt((q.area.left + q.area.right) / 2, (q.area.top + q.area.bottom) / 2), heldKey);
	assertVisible(bottom, f.presenter.visibleViewportBounds);
	const oldKeyY = q.area.top;
	f.output.visibleViewportBounds.bottom -= 5;
	f.frame(); assert.equal(q.area.top, oldKeyY - 5, 'bottom-only output changes invalidate docked hit/paint geometry');
	f.model.command(1, OnScreenKeyboardCommand.Shift); f.frame();
	assert.equal(glyph.items, 'Q');
	assert.equal(panel.area.bottom, f.output.visibleViewportBounds.bottom - 4);
	f.model.setPage(KeyboardPage.Functions);
	const functions = f.frame();
	assert.equal((functions.commandRefs[2] as GlyphRenderSubmission).items, 'KEYBOARD: FN');
	assert.equal(panel.area.bottom, f.output.visibleViewportBounds.bottom - 4, 'shorter pages retain the bottom anchor');
	assert.ok(panel.area.bottom - panel.area.top < height);
	assert.equal(f.model.isKeyPressed(heldKey), true, 'hidden-page held source remains held while relocating');
	let command = 3;
	for (const row of f.model.rows) for (const key of row.keys) {
		const rect = functions.commandRefs[command] as RectRenderSubmission; command += 3;
		assert.equal(f.keyboard.selectAt((rect.area.left + rect.area.right) / 2, (rect.area.top + rect.area.bottom) / 2), key);
	}
	f.model.close(); f.model.open(); f.frame();
	assert.equal(panel.area.bottom, f.output.visibleViewportBounds.bottom - 4, 'close/reopen retains the manually selected side');
	assert.equal(f.model.isKeyPressed(heldKey), false, 'model close still releases held input normally');
	f.keyboard.togglePosition(); f.frame();
	assert.equal(panel.area.top, top, 'the next explicit toggle returns to the unchanged top anchor');
	assert.deepEqual(f.presenter.viewportSize, { x: 256, y: 192 });
});


test('native keyboard pictograms replace only special-key artwork, remain centered, and indicate the destination docking edge', t => {
	const f = keyboardFixture(); t.after(() => f.input.dispose());
	const icons = new Map([[13, 'keyboard_backspace'], [14, 'keyboard_tab'], [28, 'keyboard_caps_lock'], [40, 'keyboard_enter'],
		[41, 'keyboard_shift'], [55, 'keyboard_space'], [56, 'keyboard_arrow_left'], [57, 'keyboard_arrow_down'],
		[58, 'keyboard_arrow_up'], [59, 'keyboard_arrow_right'], [75, 'keyboard_dock_bottom']]);
	let time = 0;
	for (const bottom of [false, true]) {
		if (bottom) f.keyboard.togglePosition();
		for (const page of [KeyboardPage.Text, KeyboardPage.Symbols, KeyboardPage.Functions]) {
			f.model.setPage(page); const frame = f.frame(); let command = 3;
			for (const row of f.model.rows) for (const target of row.keys) {
				const rect = frame.commandRefs[command] as RectRenderSubmission;
				if (icons.has(target)) {
					assert.equal(frame.commandKinds[command + 1], Host2DKind.Img); assert.equal(frame.commandKinds[command + 2], Host2DKind.Img);
					const shadow = frame.commandRefs[command + 1] as HostImageRenderSubmission, icon = frame.commandRefs[command + 2] as HostImageRenderSubmission;
					assert.equal(icon.imgid, icons.get(target)); const source = hostSystemAtlasImage(icon.imgid);
					assert.equal(source.width, 11); assert.equal(source.height, 7);
					assert.equal(icon.pos.x, rect.area.left + (((rect.area.right - rect.area.left - 11) / 2) | 0));
					assert.equal(icon.pos.y, rect.area.top + (((rect.area.bottom - rect.area.top - 7) / 2) | 0));
					assert.ok(icon.pos.x >= rect.area.left && shadow.pos.x + 11 <= rect.area.right, 'centered icon and shadow retain their real cell margins');
					assert.ok(icon.pos.y >= rect.area.top && shadow.pos.y + 7 <= rect.area.bottom);
					assert.deepEqual(icon.scale, { x: 1, y: 1 }); assert.deepEqual(shadow.scale, icon.scale);
					assert.equal(icon.flip.flip_h, false); assert.equal(icon.flip.flip_v, target === 75 && bottom);
					assert.deepEqual(shadow.flip, icon.flip);
					assert.equal(icon.colorize, target === f.model.selectedKey ? 0xff7eb4d9 : 0xffefefef);
					assert.equal(shadow.colorize, 0xff080c12);
					const originalIcon = icon;
					f.model.selectKey(target); f.frame(); assert.equal(icon.colorize, 0xff7eb4d9);
					if (target !== 75) {
						f.model.pressKey(0, target); f.frame(); assert.equal(icon.colorize, 0xffffe09a);
						f.model.releaseSource(0); f.model.updateFeedback(time += 200); f.frame();
					}
					assert.equal(frame.commandRefs[command + 2], originalIcon, 'selection and key feedback reuse the same retained image');
				} else assert.equal(frame.commandKinds[command + 2], Host2DKind.Glyphs, 'ordinary letter and punctuation glyphs are unchanged');
				command += 3;
			}
			for (let index = 0; index < frame.commandCount; index += 1) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
				assert.notEqual((frame.commandRefs[index] as GlyphRenderSubmission).items, 'MOVE', 'semantic action name is never visible keyboard artwork');
			}
			assertVisible(f.frame(), f.presenter.visibleViewportBounds);
		}
	}
});
