import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import * as colors from '../../ide/common/constants';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { RomMapKeyWindow } from '../../ide/workbench/contrib/rom_inspector/key_window';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WORKBENCH_ICON_SIZE } from '../../ide/workbench/ui/icon';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { CartRomHeader } from '../../machine/ts/rompack/format';
import type { AssetType } from '../../machine/ts/rompack/toc';
import { formatByteSize } from '../../machine/ts/common/byte_hex_string';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_symbols';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const point = (x: number, y: number, held = 0, down = 0, up = 0): PointerInputSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false,
	pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
});
const area = { left: 0, top: 20, right: 384, bottom: 274 };

function fixture(t: TestContext, variant: FontVariant = 'tiny', theme = 'light') {
	const previousTheme = colors.getActiveIdeThemeVariant(), previousCommands = inputFocus.workbenchScope.commands;
	configureFontVariant(variant); colors.setIdeThemeVariant(theme);
	const types: readonly AssetType[] = ['image', 'texture', 'audio', 'data', 'bin', 'collision_shape', 'romlabel', 'model', 'aem', 'lua', 'code'];
	const assets: RomAsset[] = types.map((type, index) => ({ resid: type, type, start: 512 + index * 128, end: 608 + index * 128 }));
	assets[7].model_texture_start = 1920; assets[7].model_texture_end = 1984;
	assets[7].collision_bin_start = 1984; assets[7].collision_bin_end = 2048;
	assets.push({ resid: BLUA32_SYMBOLS_IMAGE_ID, type: 'bin', start: 2048, end: 2112 }); finalizePackedRomAssets(assets);
	const header: CartRomHeader = { headerSize: 72, manifestOffset: 72, manifestLength: 64,
		dataOffset: 512, dataLength: 1792, metadataOffset: 2304, metadataLength: 64, tocOffset: 2400, tocLength: 128,
		blua32ImageOffset: 136, blua32ImageByteCount: 256, blua32StartupFunctionAddress: 0, blua32IrqFunctionAddress: 0,
		blua32ExceptionFunctionAddress: 0, blua32StaticLayoutTokenLo: 0, blua32StaticLayoutTokenHi: 0, blua32DiagnosticDirectoryOffset: 0 };
	const input = new RomInspectorInput({ domain: 0, sourceContextId: TEST_CARTRIDGE_CONTEXT_IDS[0], label: 'Cart 0', header, rom: new Uint8Array(4096), assets });
	Object.assign(input.layout, { ...area, bottom: 260, font: editorViewState.font, rowHeight: editorViewState.lineHeight });
	const surfaces = new WorkbenchSurfaceService(), origin = inputFocus.createTarget(), unrelated = inputFocus.createTarget();
	origin.bindKeyboard(() => {}); unrelated.bindKeyboard(() => {});
	const owner = surfaces.attach({ role: 'content', captureScope: origin.scope.surfaceScope, isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	surfaces.attach({ role: 'content', captureScope: unrelated.scope.surfaceScope, isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	const unbind = inputFocus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope);
		return surface !== undefined && surfaces.isAdmitted(surface);
	});
	const commands: EditorCommandRunner = { isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target) };
	inputFocus.workbenchScope.commands = commands; origin.focus();
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture, area);
	let key = new RomMapKeyWindow(input, commands, contextMenu, surfaces, owner, origin, area);
	const overlay = createHostOverlayFixture(384, 288);
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [], rects: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			if (frame.commandKinds[index] === Host2DKind.Rect) rects.push(frame.commandRefs[index] as RectRenderSubmission);
		}
		return { glyphs, rects };
	};
	const clickAction = (command: 'window.hide') => {
		const bounds = input.keyActions.items.find(item => item.command === command)!.bounds;
		const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
		const surface = surfaces.hitTest(x, y)!, down = point(x, y, 1, 1);
		pointerCapture.beginRoute(surface.captureScope, down); surface.handlePointer!(down, 0);
		const up = point(x, y, 0, 0, 1); pointerCapture.dispatch(up, false, 1, surface.captureScope); pointerCapture.endRoute(up);
		key.update();
	};
	t.after(() => { key.dispose(); contextMenu.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); unbind(); surfaces.dispose(); input.dispose();
		inputFocus.workbenchScope.commands = previousCommands; colors.setIdeThemeVariant(previousTheme); });
	return { input, surfaces, owner, origin, unrelated, commands, draw, clickAction, get key() { return key; },
		recreate() { key.dispose(); key = new RomMapKeyWindow(input, commands, contextMenu, surfaces, owner, origin, area); } };
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} key paints actual category swatches, complete labels, sizes and a separate total`, t => {
		const f = fixture(t, variant, theme); f.key.show();
		const seen = new Set(), model = f.input.model;
		for (const code of ['Home', 'End']) {
			inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none)); const frame = f.draw(), view = f.input.keyViewport;
			for (const entry of model.keyEntries) {
				const label = frame.glyphs.find(glyph => glyph.items === entry.category.label);
				if (label === undefined) continue;
				seen.add(entry.category);
				const size = frame.glyphs.find(glyph => glyph.y === label.y && glyph.items === entry.sizeText)!;
				assert.ok(label.x + editorViewState.font.measure(entry.category.label) <= size.x, 'the full category label cannot overlap its byte size');
				assert.ok(size.x + editorViewState.font.measure(entry.sizeText) <= view.bounds.right);
				const swatch = frame.rects.find(rect => rect.area.left === view.bounds.left && rect.area.top === label.y
					&& rect.area.right === view.bounds.left + WORKBENCH_ICON_SIZE)!;
				assert.equal(swatch.color, resolveThemeTokenColor(entry.category.color));
			}
			const total = frame.glyphs.find(glyph => glyph.items === 'Total')!;
			assert.ok(total.y > view.bounds.bottom, 'the fixed Total must not overlap scrolling rows');
			assert.ok(frame.glyphs.some(glyph => glyph.y === total.y && glyph.items === formatByteSize(f.input.snapshot.rom.length)));
		}
		assert.equal(seen.size, model.keyEntries.length, 'Home and End reveal every actual physical category');
		const bounds = { ...f.input.keyWindow.bounds }, down = point(bounds.right - 2, bounds.bottom - 2, 1, 1);
		pointerCapture.beginRoute(f.key.window.scope.surfaceScope, down); f.key.window.surface!.handlePointer!(down, 0);
		const up = point(bounds.left + 2, bounds.top + 2, 0, 0, 1);
		pointerCapture.dispatch(up, false, 1, f.key.window.scope.surfaceScope); pointerCapture.endRoute(up);
		assert.equal(f.input.keyWindow.bounds.right - f.input.keyWindow.bounds.left, f.input.keyWindow.minimumWidth);
		f.key.scroll.focusTarget.focus(); inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none));
		const narrow = f.draw();
		for (const entry of model.keyEntries) {
			const label = narrow.glyphs.find(glyph => glyph.items === entry.category.label); if (label === undefined) continue;
			const size = narrow.glyphs.find(glyph => glyph.y === label.y && glyph.items === entry.sizeText)!;
			assert.ok(label.x + editorViewState.font.measure(entry.category.label) <= size.x, 'measured minimum width still overlaps a category and size');
		}
	});
}

test('key scrolling is passive, its actual Tab ring is complete and Escape returns to the original ROM list without closing', t => {
	const f = fixture(t); f.key.show();
	const selection = f.input.model.selection, range = f.input.model.selection?.ranges[0], view = f.input.keyViewport;
	inputFocus.handleKeyboard(new KeyInputEvent('End', KeyModifier.none)); assert.equal(view.scrollTop, view.scrollbar.getMaximumScroll());
	inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none)); assert.equal(view.scrollTop, 0);
	const client = f.key.window.clientSurface!;
	assert.equal(client.handleWheel!({ valid: true, insideViewport: true, viewportX: view.bounds.left + 4, viewportY: view.bounds.top + 4,
		deltaX: 0, deltaY: 1, modifiers: KeyModifier.none }), true);
	assert.ok(view.scrollTop > 0); assert.equal(f.input.model.selection, selection); assert.equal(f.input.model.selection?.ranges[0], range);
	for (const target of [f.key.window.focusTarget, f.key.window.actionFocusTarget, f.key.scroll.focusTarget]) {
		assert.equal(inputFocus.moveFocus(false), true); assert.equal(inputFocus.target, target);
	}
	assert.equal(inputFocus.moveFocus(true), true); assert.equal(inputFocus.target, f.key.window.actionFocusTarget);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none)); assert.equal(inputFocus.target, f.origin); assert.equal(f.input.keyWindow.open, true);
});

test('client-owned close and the title close action retire capture without replacing its snapshot or viewport', t => {
	const f = fixture(t); f.key.show(); inputFocus.handleKeyboard(new KeyInputEvent('End', KeyModifier.none));
	const context = f.key.scroll.focusTarget;
	assert.ok(context.getCommand('window.hide') === f.key.window.focusTarget.getCommand('window.hide'));
	assert.equal(f.commands.isEnabled('window.hide', context), true);
	assert.equal(inputFocus.target, context);
	const view = f.input.keyViewport, scroll = view.scrollTop, snapshot = f.input.snapshot, thumb = view.scrollbar.getThumb()!;
	const down = point((thumb.left + thumb.right) / 2, (thumb.top + thumb.bottom) / 2, PointerButton.Primary, PointerButton.Primary);
	pointerCapture.beginRoute(f.key.window.clientScope.surfaceScope, down); f.key.window.clientSurface!.handlePointer!(down, 0);
	assert.equal(pointerCapture.active, true);
	f.commands.execute('window.hide', context); f.key.update();
	assert.equal(f.input.keyWindow.open, false); assert.ok(inputFocus.target === f.origin);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(f.key.window.clientSurface, undefined); assert.equal(view.scrollTop, scroll);
	assert.equal(f.commands.isEnabled('window.hide', context), false);
	pointerCapture.dispatch(point(down.viewportX, down.viewportY, 0, 0, 1), false, 1); pointerCapture.endRoute(point(0, 0));
	f.key.show(); assert.ok(f.key.window.clientSurface); assert.equal(view.scrollTop, scroll);
	f.clickAction('window.hide'); assert.equal(f.input.keyWindow.open, false); assert.equal(f.key.window.surface, undefined);
	assert.equal(view.scrollTop, scroll); f.key.show();
	assert.equal(f.input.snapshot, snapshot); assert.equal(view.scrollTop, scroll);
});

test('controller recreation retains placement and open state per snapshot without stealing another surface family focus', t => {
	const f = fixture(t); f.key.show();
	const model = f.input.keyWindow;
	const original = { ...model.requestedBounds }, down = point(model.header.left + 12, model.header.top + 7, 1, 1);
	pointerCapture.beginRoute(f.key.window.scope.surfaceScope, down); f.key.window.surface!.handlePointer!(down, 0);
	const up = point(down.viewportX - 20, down.viewportY - 10, 0, 0, 1);
	pointerCapture.dispatch(up, false, 1, f.key.window.scope.surfaceScope); pointerCapture.endRoute(up); f.key.update();
	assert.notDeepEqual(model.requestedBounds, original, 'the actual key title drag must change retained placement');
	f.key.scroll.focusTarget.focus(); inputFocus.handleKeyboard(new KeyInputEvent('End', KeyModifier.none));
	const requested = { ...model.requestedBounds }, scroll = f.input.keyViewport.scrollTop;
	f.unrelated.focus();
	f.recreate(); assert.equal(model.open, true);
	f.key.update(); assert.equal(inputFocus.target, f.unrelated);
	assert.deepEqual(model.requestedBounds, requested); assert.equal(f.input.keyViewport.scrollTop, scroll);
	assert.equal(f.key.window.clientSurface!.visible, true);
	f.key.window.hide(); assert.equal(inputFocus.target, f.unrelated);
	f.recreate(); f.key.update(); assert.equal(model.open, false); assert.equal(f.key.window.surface, undefined);
	f.key.show(); assert.deepEqual(model.requestedBounds, requested); assert.equal(f.input.keyViewport.scrollTop, scroll);
	const other = new RomInspectorInput({ ...f.input.snapshot, rom: f.input.snapshot.rom.slice() }); t.after(() => other.dispose());
	assert.equal(other.keyWindow.open, false); assert.equal(other.keyPlacementInitialized, false);
});

test('closed keys do no label measurement or hidden client painting before or after their first attachment', t => {
	const f = fixture(t), font = editorViewState.font;
	let measurements = 0;
	const measure = font.measure.bind(font), advance = font.advance.bind(font);
	t.mock.method(font, 'measure', (text: string) => { measurements++; return measure(text); });
	t.mock.method(font, 'advance', (text: string) => { measurements++; return advance(text); });
	f.recreate();
	for (let frame = 0; frame < 1000; frame++) f.key.update();
	assert.equal(measurements, 0, 'a closed input must not lay out or measure the key');
	f.key.show(); assert.ok(measurements > 0);
	f.key.window.hide(); f.key.update(); f.draw(); measurements = 0;
	for (let frame = 0; frame < 1000; frame++) {
		f.key.update();
		const drawn = f.draw();
		assert.ok(!drawn.glyphs.some(glyph => f.input.model.keyEntries.some(entry => glyph.items === entry.category.label)));
	}
	assert.equal(measurements, 0, 'a closed window cannot measure or paint its retained key document');
});
