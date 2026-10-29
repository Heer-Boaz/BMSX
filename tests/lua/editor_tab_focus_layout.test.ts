import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { drawEditorText } from '../../ide/editor/render/text_renderer';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import * as colors from '../../ide/common/constants';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { EditorTabStrip } from '../../ide/workbench/ui/tab/control';
import type { EditorTabDragHandler } from '../../ide/workbench/ui/tab/drag';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import type { EditorTabId } from '../../ide/workbench/ui/tab/id';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { RectRenderKind, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';

/** Geometry assertions exercise the strip's interval-reveal and retained paint contracts. */
function fixture(t: TestContext, count = 12, variant: 'tiny' | 'msx' = 'tiny') {
	const model = new EditorTabGroupModel(), copies: EditorTextModel[] = [], inputs: CodeEditorInput[] = [];
	const font = new EditorFont(variant);
	let measurements = 0;
	const context = {
		font: font.renderFont(), tabBarHeight: font.lineHeight + 3, charAdvance: font.advance('M'),
		measureText(text: string) { measurements++; return font.measure(text); },
		measureTextRange(text: string, from: number, to: number) { measurements++; return font.measure(text.slice(from, to)); },
		drawText(text: string, x: number, y: number, z: number, color: number) { drawEditorText(font, text, x, y, z, color); },
	};
	const parent = inputFocus.createTarget(null, new InputFocusScope(Symbol('focused tab layout')));
	const menuArea = { left: 0, top: 0, right: 384, bottom: 96 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, menuArea);
	const inertDragHandler: EditorTabDragHandler = { update() {}, drop() {}, clear() {} };
	const strip = new EditorTabStrip(model, context, { isEnabled: () => true, execute() {} }, parent,
		id => { model.activate(model.findById(id)!); return true; }, id => model.removeAt(model.indexOf(model.findById(id)!)),
		() => true, inertDragHandler, menu);
	for (let index = 0; index < count; index++) {
		const path = `focused-${index}.lua`;
		const copy = new EditorTextModel({ contextLabel: 'Focus layout', sourceFilePath: path,
			location: { kind: 'workspace', path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
			source: { type: 'lua', resid: path } }, 'lua', 'return {}');
		const input = new CodeEditorInput(copy); input.setLabel(`tab ${index}`, path);
		copies.push(copy); inputs.push(input); model.add(input, { pinned: true });
	}
	model.activate(inputs[0]);
	const bounds = { left: 11, top: 23, right: 267, bottom: 23 };
	const layout = (focused: EditorInput | null = null, hover: EditorTabId | null = null, dragging = false) =>
		strip.layoutState.layout(bounds, context, hover, dragging, focused);
	const item = (input: EditorInput) => strip.layoutState.items.peek(model.indexOf(input));
	const visible = (input: EditorInput) => {
		const tab = item(input).bounds, viewport = strip.layoutState.viewportBounds;
		assert.ok(tab.left >= viewport.left && tab.right <= viewport.right, 'the requested complete tab interval is visible');
	};
	t.after(() => {
		strip.dispose(); menu.dispose(); model.clear(); parent.release();
		for (const copy of copies) copy.dispose();
	});
	return { model, strip, inputs, bounds, context, layout, item, visible, measurements: () => measurements };
}

test('keyboard focus reveals its exact inactive tab independently of the active pane without replacing records or measurements', t => {
	const f = fixture(t), first = f.inputs[0], last = f.inputs.at(-1)!;
	f.layout();
	const records = Array.from(f.strip.layoutState.items), bounds = f.item(last).bounds, measured = f.measurements();
	assert.equal(f.strip.scrollbar.getScroll(), 0);
	f.layout(last);
	f.visible(last);
	assert.ok(f.model.activeTab === first);
	assert.equal(f.item(first).active, true); assert.equal(f.item(first).focused, false);
	assert.equal(f.item(last).active, false); assert.equal(f.item(last).focused, true);
	assert.equal(f.strip.scrollbar.getScroll() > 0, true);
	assert.equal(f.measurements(), measured);
	assert.ok(f.item(last).bounds === bounds);
	for (let index = 0; index < records.length; index++) assert.ok(f.strip.layoutState.items.peek(index) === records[index]);
	f.layout(first); f.visible(first);
	assert.equal(f.item(first).focused, true); assert.equal(f.item(last).focused, false);
});

test('stationary keyboard focus, hover, harmless model publications and focus loss preserve manual tab scrolling', t => {
	const f = fixture(t), last = f.inputs.at(-1)!;
	f.layout(last); f.strip.scrollbar.setScroll(0);
	const measured = f.measurements();
	for (let frame = 0; frame < 100; frame++) f.layout(last, frame % 2 === 0 ? last.id : null);
	assert.equal(f.strip.scrollbar.getScroll(), 0);
	assert.equal(f.measurements(), measured);
	last.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	f.layout(last);
	assert.equal(f.item(last).dirty, true);
	assert.equal(f.strip.scrollbar.getScroll(), 0, 'dirty publication is not another keyboard-reveal request');
	f.layout(null); assert.equal(f.strip.scrollbar.getScroll(), 0);
	f.layout(last); f.visible(last);
	const scroll = f.strip.scrollbar.getScroll();
	f.layout(null);
	assert.equal(f.strip.scrollbar.getScroll(), scroll, 'opening a menu must not reveal a different active pane on strip blur');
	assert.equal(f.item(last).focused, false);
});

test('focused interval and viewport changes reveal the retained exact input while drag scroll remains authoritative', t => {
	const f = fixture(t), focused = f.inputs[1];
	f.layout(focused);
	const measured = f.measurements();
	f.model.move(1, f.inputs.length - 1);
	f.layout(focused); f.visible(focused);
	assert.equal(f.measurements(), measured, 'reordering retains each input\'s measured label');
	f.bounds.right -= 64;
	f.layout(focused); f.visible(focused);
	f.strip.scrollbar.setScroll(0); f.layout(focused, null, true);
	assert.equal(f.strip.scrollbar.getScroll(), 0, 'a captured drag owns its own edge scrolling');
	f.layout(focused); assert.equal(f.strip.scrollbar.getScroll(), 0);
	f.strip.layoutState.clear();
	f.layout(focused); f.visible(focused);
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) for (const active of [false, true]) {
	test(`${variant}/${theme} ${active ? 'active' : 'inactive'} tab focus preserves bitmap label ink and changes only the existing border footprint`, t => {
		const previousTheme = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme);
		t.after(() => colors.setIdeThemeVariant(previousTheme));
		const f = fixture(t, 3, variant), focused = f.inputs[1];
		focused.setLabel('CART.LUA', focused.description);
		if (active) f.model.activate(focused);
		f.layout();
		const entry = f.item(focused), bounds = entry.bounds, selected = f.model.activeTab;
		const measured = f.measurements(), scroll = f.strip.scrollbar.getScroll(), revision = f.strip.layoutState.revision;
		const width = 384, height = 96, overlay = createHostOverlayFixture(width, height);
		const paint = () => {
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
			f.strip.draw(f.context); overlay.renderer.endFrame();
			const frame = overlay.queue.consumeOverlayFrame(), pixels = overlay.backend.framebufferPixels;
			pixels.fill(0);
			beginHeadlessHost2D(overlay.backend.hostOverlayContext, pixels, width, height);
			for (let index = 0; index < frame.commandCount; index++)
				renderHeadlessHost2DEntry(overlay.backend.hostOverlayContext, frame.commandKinds[index], frame.commandRefs[index]);
			return { frame, pixels: overlay.backend.framebufferWords.slice() };
		};
		const unfocused = paint();
		let labels = 0;
		for (let index = 0; index < unfocused.frame.commandCount; index++) if (unfocused.frame.commandKinds[index] === Host2DKind.Glyphs) {
			const glyphs = unfocused.frame.commandRefs[index] as GlyphRenderSubmission;
			if (glyphs.items === entry.text) { labels++; assert.ok(glyphs.font === f.context.font); }
		}
		assert.equal(labels, 1, 'the real bitmap label is submitted, not a no-text paint fixture');
		const background = unfocused.pixels[(bounds.top + 1) * width + bounds.left + 1];
		for (const y of [bounds.top + 1, bounds.bottom - 2]) {
			let ink = 0;
			for (let x = bounds.left + 1; x < bounds.right - 1; x++) if (unfocused.pixels[y * width + x] !== background) ink++;
			assert.ok(ink > 0, 'both edge rows contain shipped label ink that focus must preserve');
		}
		f.layout(focused);
		const focusedPaint = paint(), borderColor = focusedPaint.pixels[bounds.top * width + bounds.left];
		let focusOutlines = 0, changed = 0;
		for (let index = 0; index < focusedPaint.frame.commandCount; index++) if (focusedPaint.frame.commandKinds[index] === Host2DKind.Rect) {
			const rect = focusedPaint.frame.commandRefs[index] as RectRenderSubmission;
			if (rect.kind === RectRenderKind.Rect && rect.color === resolveThemeTokenColor(colors.COLOR_FOCUS_BORDER)) focusOutlines++;
		}
		assert.equal(focusOutlines, 1, 'the focused entry uses the shared theme focus color');
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = y * width + x;
			const onBorder = x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom
				&& (x === bounds.left || x === bounds.right - 1 || y === bounds.top || y === bounds.bottom - 1);
			if (onBorder) {
				assert.equal(focusedPaint.pixels[offset], borderColor, 'focus remains a complete border even on the active tab');
				if (focusedPaint.pixels[offset] !== unfocused.pixels[offset]) changed++;
			} else assert.equal(focusedPaint.pixels[offset], unfocused.pixels[offset], `focus changed label/interior or unrelated paint at ${x},${y}`);
		}
		assert.ok(changed > 0, 'keyboard focus is visible on the existing border');
		assert.ok(f.model.activeTab === selected && f.item(focused) === entry && entry.bounds === bounds);
		assert.equal(entry.active, active); assert.equal(entry.focused, true);
		assert.equal(f.measurements(), measured); assert.equal(f.strip.scrollbar.getScroll(), scroll);
		assert.equal(f.strip.layoutState.revision, revision);
		f.layout();
		assert.deepEqual(paint().pixels, unfocused.pixels, 'focus loss restores the original paint without changing selection');
	});
}
