import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import type { CodeEditorControl } from '../../ide/editor/ui/code_editor_control';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { drawCursor } from '../../ide/editor/render/caret';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { invertThemeToken, resolveThemeTokenColor } from '../../ide/theme/tokens';

function renderActiveCursor(code: CodeEditorControl, baseColor: number): HostOverlayFrame {
	const { presenter, queue, renderer } = createHostOverlayFixture(64, 32);
	renderer.beginFrame(presenter);
	api.beginFrame(renderer);
	drawCursor(code, {
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
	return queue.consumeOverlayFrame();
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) test(`${variant}/${theme} active code caret glyph contrasts with its actual block fill, independent of source syntax`, (t) => {
	const originalTheme = constants.getActiveIdeThemeVariant();
	t.after(() => {
		constants.setIdeThemeVariant(originalTheme);
	});

	constants.setIdeThemeVariant(theme);
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ sourceFilePath: 'caret.lua', location: { kind: 'workspace', path: 'caret.lua' }, domain: 0, path: 'caret.lua', source: { type: 'lua', resid: 'caret' } }, 'lua', 'A');
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant));
	const darkBaseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME;
	const lightBaseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
	const darkFrame = renderActiveCursor(code, darkBaseColor);
	const lightFrame = renderActiveCursor(code, lightBaseColor);
	const darkGlyphs = darkFrame.commandRefs[1] as GlyphRenderSubmission;
	const lightGlyphs = lightFrame.commandRefs[1] as GlyphRenderSubmission;

	assert.equal(darkFrame.commandCount, 2);
	assert.equal(darkFrame.commandKinds[0], Host2DKind.Rect);
	assert.equal(darkFrame.commandKinds[1], Host2DKind.Glyphs);
	assert.equal(darkGlyphs.items, 'A');
	assert.equal(darkGlyphs.color, resolveThemeTokenColor(invertThemeToken(constants.CARET_COLOR)));

	assert.equal(lightFrame.commandCount, 2);
	assert.equal(lightFrame.commandKinds[0], Host2DKind.Rect);
	assert.equal(lightFrame.commandKinds[1], Host2DKind.Glyphs);
	assert.equal(lightGlyphs.items, 'A');
	assert.equal(lightGlyphs.color, resolveThemeTokenColor(invertThemeToken(constants.CARET_COLOR)));
	assert.equal(darkGlyphs.color, lightGlyphs.color);
});
