import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { api } from '../../ide/runtime/overlay_api';
import { getWorkbenchEditorBounds, refreshWorkbenchLayout, topMargin } from '../../ide/workbench/common/layout';
import { drawEditorGroupWatermark } from '../../ide/workbench/render/editor_group_watermark';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';

configureFontVariant('tiny');

function fixture(t: TestContext, variant: 'tiny' | 'msx', theme: string) {
	const previous = { width: editorViewState.viewportWidth, height: editorViewState.viewportHeight,
		left: editorViewState.editorAreaLeft, inset: editorChromeState.editorRightInset, variant: editorViewState.font.variant,
		theme: colors.getActiveIdeThemeVariant() };
	configureFontVariant(variant); colors.setIdeThemeVariant(theme);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const overlay = createHostOverlayFixture(384, 288);
	t.after(() => {
		configureFontVariant(previous.variant); colors.setIdeThemeVariant(previous.theme);
		editorViewState.viewportWidth = previous.width; editorViewState.viewportHeight = previous.height;
		editorViewState.editorAreaLeft = previous.left; editorChromeState.editorRightInset = previous.inset; refreshWorkbenchLayout();
	});
	const draw = (left: number, width: number, height = 288) => {
		editorViewState.editorAreaLeft = left; editorChromeState.editorRightInset = 384 - left - width;
		editorViewState.viewportHeight = height; refreshWorkbenchLayout();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); drawEditorGroupWatermark(); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
			glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
		const bounds = getWorkbenchEditorBounds();
		for (const glyph of glyphs) {
			assert.ok(glyph.x >= bounds.left + 4 && glyph.x + editorViewState.font.measure(glyph.items as string) <= bounds.right - 4,
				`complete hint escaped ${width}px editor group: ${glyph.items}`);
			assert.ok(glyph.y >= bounds.top + 4 && glyph.y + editorViewState.lineHeight <= bounds.bottom - 4);
		}
		return glyphs;
	};
	return { draw };
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} empty-group hints keep whole command/shortcut pairs inside wide and narrow editor groups`, t => {
		const f = fixture(t, variant, theme), wide = f.draw(0, 384);
		assert.equal(wide.length, 8);
		assert.equal(wide[0].color, resolveThemeTokenColor(colors.COLOR_DESCRIPTION_TEXT), 'descriptions use neutral editor-surface ink, not inactive tab ink');
		assert.equal(wide[0].y, wide[1].y, 'wide groups retain aligned command and keybinding columns');
		const narrow = f.draw(222, 162);
		assert.equal(narrow.length, 8);
		if (variant === 'msx') assert.equal(narrow[1].y, narrow[0].y + editorViewState.lineHeight);
		const minimum = f.draw(24, variant === 'tiny' ? 78 : 118);
		assert.equal(minimum.length, 8);
		assert.equal(minimum[1].y, minimum[0].y + editorViewState.lineHeight);
		assert.equal(f.draw(280, 32).length, 0, 'optional hints cannot paint partial keyboard chords');
	});
}

test('a short empty group admits only complete command pairs, in discovery order', t => {
	const f = fixture(t, 'msx', 'light');
	const height = topMargin() + editorViewState.baseBottomMargin + editorViewState.lineHeight * 6 + 8;
	const glyphs = f.draw(222, 162, height);
	assert.equal(glyphs.length, 4); assert.equal(glyphs[0].items, 'COMMAND PALETTE');
});

test('idle empty-group paints reuse font measurements and retained hint strings', t => {
	const f = fixture(t, 'tiny', 'dark'); f.draw(24, 78);
	const font = editorViewState.font, measurement = t.mock.method(font, 'measure');
	// The fixture's bounds assertions measure the eight submissions. The watermark itself does not.
	for (let frame = 0; frame < 100; frame++) f.draw(24, 78);
	assert.equal(measurement.mock.callCount(), 800);
});
