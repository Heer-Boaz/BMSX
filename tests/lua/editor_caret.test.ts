import assert from 'node:assert/strict';
import test from 'node:test';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { consumeOverlayFrame, type HostOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { drawCursor } from '../../ide/editor/render/caret';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { invertThemeToken, resolveThemeTokenColor } from '../../ide/theme/tokens';

function renderActiveCursor(baseColor: number): HostOverlayFrame {
	const renderer = new OverlayRenderer();
	renderer.beginFrame({
		offscreenCanvasSize: { x: 64, y: 32 },
		viewportSize: { x: 64, y: 32 },
	});
	api.beginFrame(renderer);
	drawCursor({
		row: 0,
		column: 0,
		x: 8,
		y: 4,
		width: 6,
		height: 8,
		baseChar: 'A',
		baseColor,
	}, 0, true);
	renderer.endFrame();
	return consumeOverlayFrame();
}

test('active code caret redraws the underlying glyph with its inverse color', (t) => {
	const originalTheme = constants.getActiveIdeThemeVariant();
	const originalFont = editorViewState.font;
	t.after(() => {
		constants.setIdeThemeVariant(originalTheme);
		editorViewState.font = originalFont;
	});

	constants.setIdeThemeVariant('light');
	editorViewState.font = new EditorFont('msx');
	const darkBaseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME;
	const lightBaseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
	const darkFrame = renderActiveCursor(darkBaseColor);
	const lightFrame = renderActiveCursor(lightBaseColor);
	const darkGlyphs = darkFrame.commandRefs[1] as GlyphRenderSubmission;
	const lightGlyphs = lightFrame.commandRefs[1] as GlyphRenderSubmission;

	assert.equal(darkFrame.commandCount, 2);
	assert.equal(darkFrame.commandKinds[0], Host2DKind.Rect);
	assert.equal(darkFrame.commandKinds[1], Host2DKind.Glyphs);
	assert.equal(darkGlyphs.items, 'A');
	assert.equal(darkGlyphs.color, resolveThemeTokenColor(invertThemeToken(darkBaseColor)));

	assert.equal(lightFrame.commandCount, 2);
	assert.equal(lightFrame.commandKinds[0], Host2DKind.Rect);
	assert.equal(lightFrame.commandKinds[1], Host2DKind.Glyphs);
	assert.equal(lightGlyphs.items, 'A');
	assert.equal(lightGlyphs.color, resolveThemeTokenColor(invertThemeToken(lightBaseColor)));
	assert.notEqual(darkGlyphs.color, lightGlyphs.color);
});
