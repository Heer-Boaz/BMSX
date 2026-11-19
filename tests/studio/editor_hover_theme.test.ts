import assert from 'node:assert/strict';
import test from 'node:test';
import * as constants from '../../ide/common/constants';
import { CodeTextDecoration } from '../../ide/common/models';
import { THEME_TOKEN_BLACK, THEME_TOKEN_WHITE, THEME_TOKEN_COLORS, invertThemeToken, resolveThemeTokenColor } from '../../ide/theme/tokens';
import { contrastRatio } from '../helpers/contrast.mjs';

function contrastOfTokens(foreground: number, background: number): number {
	const colors = [foreground, background].map(resolveThemeTokenColor);
	for (const color of colors) assert.equal(color >>> 24, 255, 'underlying source cannot change the text/surface contrast');
	return contrastRatio(colors[0], colors[1]);
}

for (const theme of ['dark', 'light']) {
	for (const name of Object.keys(constants.COLOR_SYNTAX_HIGHLIGHTS) as Array<keyof typeof constants.COLOR_SYNTAX_HIGHLIGHTS>) {
		test(`${theme} editor body ${name} remains readable as informative text`, () => {
			constants.setIdeThemeVariant(theme);
			const minimum = name === 'COLOR_CODE_TEXT' ? 7 : 4.5;
			const contrast = contrastOfTokens(constants.COLOR_SYNTAX_HIGHLIGHTS[name], constants.COLOR_CODE_BACKGROUND);
			assert.ok(contrast >= minimum, `${theme} ${name} contrast is ${contrast}:1, required ${minimum}:1`);
			const executionContrast = contrastOfTokens(constants.COLOR_SYNTAX_HIGHLIGHTS[name], constants.EXECUTION_STOP_OVERLAY);
			assert.ok(executionContrast >= minimum, `${theme} execution ${name} contrast is ${executionContrast}:1, required ${minimum}:1`);
		});
	}
	test(`${theme} inline completion text remains readable on the editor body`, () => {
		constants.setIdeThemeVariant(theme);
		const contrast = contrastOfTokens(constants.COLOR_COMPLETION_PREVIEW_TEXT, constants.COLOR_CODE_BACKGROUND);
		assert.ok(contrast >= 4.5, `${theme} inline completion contrast is ${contrast}:1`);
		const executionContrast = contrastOfTokens(constants.COLOR_COMPLETION_PREVIEW_TEXT, constants.EXECUTION_STOP_OVERLAY);
		assert.ok(executionContrast >= 4.5, `${theme} execution inline completion contrast is ${executionContrast}:1`);
	});
	test(`${theme} idle source line numbers remain readable on the actual gutter`, () => {
		constants.setIdeThemeVariant(theme);
		const contrast = contrastOfTokens(constants.COLOR_GUTTER_TEXT, constants.COLOR_GUTTER_BACKGROUND);
		assert.ok(contrast >= 4.5, `${theme} idle gutter contrast is ${contrast}:1`);
	});
	for (const state of ['current', 'execution'] as const) test(`${theme} ${state} source line numbers use their actual gutter pair`, () => {
		constants.setIdeThemeVariant(theme);
		const foreground = state === 'current' ? constants.COLOR_GUTTER_ACTIVE_TEXT : constants.COLOR_GUTTER_EXECUTION_TEXT;
		const background = state === 'current' ? constants.COLOR_GUTTER_ACTIVE_BACKGROUND : constants.COLOR_GUTTER_EXECUTION_BACKGROUND;
		const contrast = contrastOfTokens(foreground, background);
		assert.ok(contrast >= 4.5, `${theme} ${state} gutter contrast is ${contrast}:1`);
	});
	test(`${theme} the active code caret glyph remains readable on its actual block fill`, () => {
		constants.setIdeThemeVariant(theme);
		const contrast = contrastOfTokens(invertThemeToken(constants.CARET_COLOR), constants.CARET_COLOR);
		assert.ok(contrast >= 4.5, `${theme} caret glyph contrast is ${contrast}:1`);
	});
	for (let role = CodeTextDecoration.None; role <= CodeTextDecoration.Selection; role++) {
		test(`${theme} ${CodeTextDecoration[role]} decoration has a complete opaque readable text and marker pair`, () => {
			constants.setIdeThemeVariant(theme);
			const style = constants.CODE_TEXT_DECORATION_STYLES[role];
			const contrast = contrastOfTokens(style.foreground, style.background);
			assert.ok(contrast >= 4.5, `${theme} ${CodeTextDecoration[role]} foreground contrast is ${contrast}:1`);
			for (const marker of ['errorUnderline', 'warningUnderline', 'gotoUnderline'] as const) {
				const markerContrast = contrastOfTokens(style[marker], style.background);
				assert.ok(markerContrast >= 3, `${theme} ${CodeTextDecoration[role]} ${marker} contrast is ${markerContrast}:1`);
			}
		});
	}
	test(`${theme} undecorated execution text keeps all three marker inks visible on its own background`, () => {
		constants.setIdeThemeVariant(theme);
		const style = constants.CODE_TEXT_DECORATION_STYLES[CodeTextDecoration.None];
		assert.equal(constants.COLOR_DIAGNOSTIC_ERROR, style.errorUnderline);
		assert.equal(constants.COLOR_DIAGNOSTIC_WARNING, style.warningUnderline);
		assert.equal(constants.COLOR_GOTO_UNDERLINE, style.gotoUnderline);
		for (const marker of ['errorUnderline', 'warningUnderline', 'gotoUnderline'] as const) {
			const contrast = contrastOfTokens(style[marker], constants.EXECUTION_STOP_OVERLAY);
			assert.ok(contrast >= 3, `${theme} execution ${marker} contrast is ${contrast}:1`);
		}
	});
	test(`${theme} resource source-match text uses its own readable surface pair`, () => {
		constants.setIdeThemeVariant(theme);
		const contrast = contrastOfTokens(constants.COLOR_RESOURCE_MATCH_TEXT, constants.COLOR_RESOURCE_MATCH_BACKGROUND);
		assert.ok(contrast >= 4.5, `${theme} resource source match contrast is ${contrast}:1`);
	});
}

test('the central inverse palette selects readable black or white for every opaque token', () => {
	for (let token = 0; token < THEME_TOKEN_COLORS.length; token++) {
		if (THEME_TOKEN_COLORS[token] >>> 24 !== 255) continue;
		const inverse = invertThemeToken(token);
		assert.ok(inverse === THEME_TOKEN_BLACK || inverse === THEME_TOKEN_WHITE);
		const contrast = contrastOfTokens(inverse, token);
		assert.ok(contrast >= 4.5, `token ${token} inverse contrast is ${contrast}:1`);
	}
});

test('theme changes publish into the retained decoration table and style records', () => {
	const styles = constants.CODE_TEXT_DECORATION_STYLES, retained = styles.slice();
	for (const theme of ['dark', 'light']) {
		constants.setIdeThemeVariant(theme);
		assert.equal(constants.CODE_TEXT_DECORATION_STYLES, styles);
		for (let role = CodeTextDecoration.None; role <= CodeTextDecoration.Selection; role++) assert.equal(styles[role], retained[role]);
	}
});

test('hover and Markdown text retain readable contrast on their actual surfaces in both themes', () => {
	for (const theme of ['dark', 'light']) {
		constants.setIdeThemeVariant(theme);
		for (const [name, foreground, background, minimum] of [
			['editor', constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT, constants.COLOR_CODE_BACKGROUND, 7],
			['workbench', constants.COLOR_RESOURCE_VIEWER_TEXT, constants.COLOR_RESOURCE_VIEWER_BACKGROUND, 7],
			['changed inspector value', constants.COLOR_INSPECTOR_VALUE_CHANGED, constants.COLOR_RESOURCE_VIEWER_BACKGROUND, 4.5],
			['inspector warning value', constants.COLOR_INSPECTOR_WARNING_TEXT, constants.COLOR_RESOURCE_VIEWER_BACKGROUND, 4.5],
			['property tree group', constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND, 4.5],
			['property tree warning group', constants.COLOR_PROBLEMS_PANEL_WARNING, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND, 4.5],
			['property tree warning value', constants.COLOR_INSPECTOR_WARNING_TEXT, constants.COLOR_CODE_BACKGROUND, 4.5],
			['inspector property label', constants.COLOR_INSPECTOR_LABEL, constants.COLOR_RESOURCE_VIEWER_BACKGROUND, 4.5],
			['inspector description', constants.COLOR_DESCRIPTION_TEXT, constants.COLOR_RESOURCE_VIEWER_BACKGROUND, 4.5],
			['empty-group description', constants.COLOR_DESCRIPTION_TEXT, constants.COLOR_CODE_BACKGROUND, 4.5],
			['inserted diff source', constants.COLOR_RESOURCE_VIEWER_TEXT, constants.COLOR_DIFF_INSERTED_BACKGROUND, 7],
			['removed diff source', constants.COLOR_RESOURCE_VIEWER_TEXT, constants.COLOR_DIFF_REMOVED_BACKGROUND, 7],
			['stale review status', constants.COLOR_INSPECTOR_WARNING_TEXT, constants.COLOR_CODE_BACKGROUND, 4.5],
			['diagnostic resource location', constants.COLOR_PROBLEMS_PANEL_LOCATION, constants.COLOR_PROBLEMS_PANEL_BACKGROUND, 4.5],
			['diagnostic error marker', constants.COLOR_PROBLEMS_PANEL_ERROR, constants.COLOR_PROBLEMS_PANEL_BACKGROUND, 4.5],
			['diagnostic warning marker', constants.COLOR_PROBLEMS_PANEL_WARNING, constants.COLOR_PROBLEMS_PANEL_BACKGROUND, 4.5],
			['diagnostic hovered message', constants.COLOR_PROBLEMS_PANEL_HOVER_TEXT, constants.COLOR_PROBLEMS_PANEL_BACKGROUND, 4.5],
			['active window title', constants.COLOR_WINDOW_HEADER_ACTIVE_TEXT, constants.COLOR_WINDOW_HEADER_ACTIVE_BACKGROUND, 4.5],
			['inactive window title', constants.COLOR_WINDOW_HEADER_INACTIVE_TEXT, constants.COLOR_WINDOW_HEADER_INACTIVE_BACKGROUND, 4.5],
			['status', constants.COLOR_STATUS_TEXT, constants.COLOR_STATUS_BACKGROUND, 4.5],
			['strong emphasis', constants.COLOR_TEXT_STRONG, constants.COLOR_CODE_BACKGROUND, 7],
			['hover', constants.HOVER_TOOLTIP_TEXT, constants.HOVER_TOOLTIP_BACKGROUND, 7],
			['Markdown code', constants.COLOR_MARKDOWN_CODE_TEXT, constants.COLOR_MARKDOWN_CODE_BACKGROUND, 7],
			['Markdown status', constants.COLOR_MARKDOWN_MUTED_TEXT, constants.COLOR_CODE_BACKGROUND, 4.5],
			['Markdown link', constants.COLOR_MARKDOWN_LINK_TEXT, constants.COLOR_CODE_BACKGROUND, 4.5],
		] as const) {
			const contrast = contrastOfTokens(foreground, background);
			assert.ok(contrast >= minimum, `${theme} ${name} contrast is ${contrast}:1`);
		}
		assert.notEqual(constants.HOVER_TOOLTIP_BORDER, constants.HOVER_TOOLTIP_BACKGROUND);
		assert.notEqual(constants.COLOR_DIFF_INSERTED_BACKGROUND, constants.COLOR_DIFF_REMOVED_BACKGROUND);
		assert.notEqual(constants.COLOR_DIFF_INSERTED_BACKGROUND, constants.COLOR_CODE_BACKGROUND);
		assert.notEqual(constants.COLOR_DIFF_REMOVED_BACKGROUND, constants.COLOR_CODE_BACKGROUND);
	}
});
