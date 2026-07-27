import assert from 'node:assert/strict';
import test from 'node:test';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { consumeOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { Host2DSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { drawCursor } from '../../ide/editor/render/caret';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { invertThemeToken, resolveThemeTokenColor } from '../../ide/theme/tokens';

function renderActiveCursor(baseColor: number): readonly Host2DSubmission[] {
	const renderer = new OverlayRenderer();
	renderer.beginFrame();
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
	return consumeOverlayFrame().commands;
}

test('active code caret redraws the underlying glyph with its inverse color', (t) => {
	const originalTheme = constants.getActiveIdeThemeVariant();
	const originalFont = editorViewState.font;
	const originalView = (machineManager as any).view;
	t.after(() => {
		constants.setIdeThemeVariant(originalTheme);
		editorViewState.font = originalFont;
		(machineManager as any).view = originalView;
	});

	constants.setIdeThemeVariant('light');
	editorViewState.font = new EditorFont('msx');
	(machineManager as any).view = {
		offscreenCanvasSize: { x: 64, y: 32 },
		viewportSize: { x: 64, y: 32 },
	};

	const darkBaseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME;
	const lightBaseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
	const darkCommands = renderActiveCursor(darkBaseColor);
	const lightCommands = renderActiveCursor(lightBaseColor);

	assert.equal(darkCommands.length, 2);
	assert.equal(darkCommands[0].type, 'rect');
	assert.equal(darkCommands[1].type, 'items');
	assert.equal(darkCommands[1].items, 'A');
	assert.equal(darkCommands[1].color, resolveThemeTokenColor(invertThemeToken(darkBaseColor)));

	assert.equal(lightCommands.length, 2);
	assert.equal(lightCommands[0].type, 'rect');
	assert.equal(lightCommands[1].type, 'items');
	assert.equal(lightCommands[1].items, 'A');
	assert.equal(lightCommands[1].color, resolveThemeTokenColor(invertThemeToken(lightBaseColor)));
	assert.notEqual(darkCommands[1].color, lightCommands[1].color);
});
