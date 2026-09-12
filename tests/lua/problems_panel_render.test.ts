import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import * as colors from '../../ide/common/constants';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import type { EditorDiagnostic, PointerSnapshot } from '../../ide/common/models';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { RectRenderKind, type RectRenderSubmission, type GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { createTestEditorPanes } from '../helpers/editor_panes';
import { PointerButton } from '../../ide/input/pointer/buttons';

const diagnostic: EditorDiagnostic = { row: 0, startColumn: 0, endColumn: 1,
	message: 'The authored source contains an undefined name and remains editable.', severity: 'error',
	contextId: 'code:0\0diagnostics.lua', path: 'diagnostics.lua' };

for (const font of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) {
	test(`Problems inactive selection preserves legible row geometry (${font}, ${theme})`, t => {
		configureFontVariant(new VirtualHeadlessClock(), font, null);
		const previousTheme = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme);
		t.after(() => colors.setIdeThemeVariant(previousTheme));
		const controller = new ProblemsPanelController(); controller.show(); controller.setDiagnostics([diagnostic]); controller.setSelectionIndex(0);
		t.after(() => controller.setFocused(false));
		const overlay = createHostOverlayFixture(256, 192);
		const bounds = { left: 8, top: 8, right: 248, bottom: 168 };
		const draw = (focused: boolean) => {
			controller.setFocused(focused);
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
			controller.draw(bounds); overlay.renderer.endFrame();
			return overlay.queue.consumeOverlayFrame();
		};
		const inactive = draw(false);
		const layout = controller.getCachedLayout();
		const rows: RectRenderSubmission[] = [], text: GlyphRenderSubmission[] = [];
		for (let index = 0; index < inactive.commandCount; index += 1) {
			if (inactive.commandKinds[index] === Host2DKind.Rect) {
				const rect = inactive.commandRefs[index] as RectRenderSubmission;
				if (rect.area.top === layout.contentTop) rows.push(rect);
			} else if (inactive.commandKinds[index] === Host2DKind.Glyphs) text.push(inactive.commandRefs[index] as GlyphRenderSubmission);
		}
		assert.equal(rows.length, 1, 'inactive selection remains visible');
		assert.equal(rows[0].kind, RectRenderKind.Fill, 'inactive selection is a background, not a line through glyph rows');
		assert.equal(rows[0].color, resolveThemeTokenColor(colors.INACTIVE_SELECTION_OVERLAY));
		assert.notEqual(colors.INACTIVE_SELECTION_OVERLAY, colors.SELECTION_OVERLAY);
		for (const run of text) {
			if (run.y < layout.contentTop) continue;
			assert.equal(run.color, resolveThemeTokenColor(run.items === 'E'
				? colors.COLOR_DIAGNOSTIC_ERROR : colors.COLOR_INACTIVE_SELECTION_TEXT));
		}
		const item = controller.getItemLayout(0);
		assert.ok(item.lines.length > 1, 'fixture exercises wrapped diagnostics');
		const active = draw(true);
		const activeText: GlyphRenderSubmission[] = [];
		for (let index = 0; index < active.commandCount; index += 1) {
			if (active.commandKinds[index] === Host2DKind.Glyphs) activeText.push(active.commandRefs[index] as GlyphRenderSubmission);
			if (active.commandKinds[index] === Host2DKind.Rect) {
				const rect = active.commandRefs[index] as RectRenderSubmission;
				if (rect.area.top === layout.contentTop) assert.equal(rect.color, resolveThemeTokenColor(colors.SELECTION_OVERLAY));
			}
		}
		for (const run of activeText) {
			if (run.y < layout.contentTop) continue;
			assert.equal(run.color, resolveThemeTokenColor(run.items === 'E'
				? colors.COLOR_DIAGNOSTIC_ERROR : colors.COLOR_SELECTION_TEXT));
		}
		assert.deepEqual(activeText.map(run => [run.items, run.x, run.y]), text.map(run => [run.items, run.x, run.y]), 'focus does not shift/reflow source diagnostics');
		assert.equal(controller.getItemLayout(0), item, 'focus retains the measured diagnostic');
		assert.equal(controller.getSelectionIndex(), 0);
		controller.setSelectionIndex(-1);
		const unselected = draw(false);
		for (let index = 0; index < unselected.commandCount; index += 1) {
			if (unselected.commandKinds[index] === Host2DKind.Rect) {
				assert.notEqual((unselected.commandRefs[index] as RectRenderSubmission).area.top, layout.contentTop, 'no implicit selection');
			}
		}
	});
}

for (const empty of [false, true]) test(`Problems owns its panel/content clips (empty: ${empty})`, t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const controller = new ProblemsPanelController(); controller.show(); controller.setDiagnostics(empty ? [] : [diagnostic]); controller.setSelectionIndex(empty ? -1 : 0);
	t.after(() => controller.setFocused(false));
	const overlay = createHostOverlayFixture(160, 96);
	const bounds = { left: 8, top: 8, right: 112, bottom: 8 + editorViewState.lineHeight * 3 + 12 };
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	controller.draw(bounds); overlay.renderer.endFrame();
	const frame = overlay.queue.consumeOverlayFrame();
	const pixels = overlay.backend.framebufferPixels;
	pixels.fill(0);
	const context = overlay.backend.hostOverlayContext;
	beginHeadlessHost2D(context, pixels, 160, 96);
	for (let index = 0; index < frame.commandCount; index += 1) renderHeadlessHost2DEntry(context, frame.commandKinds[index], frame.commandRefs[index]);
	for (let y = 0; y < 96; y += 1) for (let x = 0; x < 160; x += 1) {
		if (x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom) continue;
		assert.equal(pixels[(y * 160 + x) * 4 + 3], 0, `panel paint escaped to ${x},${y}`);
	}
	assert.deepEqual([context.clip.left, context.clip.top, context.clip.right, context.clip.bottom], [0, 0, 160, 96], 'drawing restores the caller clip');
	const layout = controller.getCachedLayout();
	const background = pixels.subarray((bounds.top * 160 + bounds.left) * 4, (bounds.top * 160 + bounds.left) * 4 + 4);
	const paddingOffset = (layout.contentBottom * 160 + bounds.left) * 4;
	assert.deepEqual(pixels.subarray(paddingOffset, paddingOffset + 4), background, 'partial rows cannot paint the bottom content padding');
});

test('Problems restores a nested caller clip and retains warm paint/layout storage', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const controller = new ProblemsPanelController();
	controller.show(); controller.setDiagnostics([diagnostic]); controller.setSelectionIndex(0);
	t.after(() => controller.setFocused(false));
	const overlay = createHostOverlayFixture(160, 96);
	const bounds = { left: 8, top: 8, right: 112, bottom: 48 };
	const caller = { left: 16, top: 10, right: 100, bottom: 80 };
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		api.pushClipRect(caller.left, caller.top, caller.right, caller.bottom);
		controller.draw(bounds);
		api.fill_rect(0, 60, 160, 70, 0, colors.COLOR_SELECTION_TEXT);
		api.popClipRect(); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame();
		stream.reset(160, 96);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		return frame;
	};
	const frames = [draw(), draw()];
	const refs = frames.map(frame => frame.commandRefs.slice(0, frame.commandCount));
	const floats = stream.floatData;
	const batches = stream.batches.slice();
	const item = controller.getItemLayout(0), lines = item.lines;
	for (let index = 0; index < 100; index += 1) {
		const frame = draw();
		assert.equal(frame, frames[index % 2]);
		assert.equal(frame.commandCount, refs[index % 2].length);
		for (let command = 0; command < frame.commandCount; command += 1) assert.equal(frame.commandRefs[command], refs[index % 2][command]);
		assert.equal(stream.floatData, floats);
		for (let batch = 0; batch < batches.length; batch += 1) assert.equal(stream.batches[batch], batches[batch]);
		assert.equal(controller.getItemLayout(0), item); assert.equal(item.lines, lines);
	}
	const frame = draw();
	const pixels = overlay.backend.framebufferPixels;
	const context = overlay.backend.hostOverlayContext;
	beginHeadlessHost2D(context, pixels, 160, 96);
	for (let index = 0; index < frame.commandCount; index += 1) renderHeadlessHost2DEntry(context, frame.commandKinds[index], frame.commandRefs[index]);
	for (let y = 0; y < 96; y += 1) for (let x = 0; x < 160; x += 1) {
		if (x >= caller.left && x < caller.right && y >= caller.top && y < caller.bottom) continue;
		assert.equal(pixels[(y * 160 + x) * 4 + 3], 0, 'panel cannot expand its caller clip');
	}
	assert.equal(pixels[(65 * 160 + 20) * 4 + 3], 255, 'subsequent caller paint is not trapped in the panel');
});

test('Problems padding and header cannot hover clipped row geometry', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const controller = new ProblemsPanelController();
	controller.show(); controller.setDiagnostics([diagnostic]); controller.setSelectionIndex(-1);
	t.after(() => controller.setFocused(false));
	const panes = createTestEditorPanes(); t.after(() => panes.dispose());
	const bounds = { left: 8, top: 8, right: 112, bottom: 38 };
	const layout = controller.prepareLayout(bounds);
	const snapshot: PointerSnapshot = { valid: true, insideViewport: true, viewportX: 12, viewportY: 0,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	for (const y of [bounds.top, layout.contentTop - 1, layout.contentBottom, bounds.bottom - 1]) for (const pressed of [false, true]) {
		controller.setHoverIndex(0); snapshot.viewportY = y;
		snapshot.pressedButtons = snapshot.justPressedButtons = pressed ? PointerButton.Primary : 0;
		assert.equal(controller.handlePointer(panes, snapshot, pressed, false, bounds), true);
		assert.equal(controller.getHoverIndex(), -1);
		assert.equal(controller.getSelectionIndex(), -1);
		assert.equal(panes.activePane, null);
	}
});
