import assert from 'node:assert/strict';
import test from 'node:test';
import * as constants from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';

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
			const colors = [foreground, background].map(resolveThemeTokenColor);
			for (const color of colors) assert.equal(color >>> 24, 255, 'underlying source cannot change the text/surface contrast');
			// WCAG relative luminance in linear sRGB, not a brightness heuristic.
			const luminances = colors.map(color => {
				const rgb = [color >>> 16 & 255, color >>> 8 & 255, color & 255]
					.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
				return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
			});
			const contrast = (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
			assert.ok(contrast >= minimum, `${theme} ${name} contrast is ${contrast}:1`);
		}
		assert.notEqual(constants.HOVER_TOOLTIP_BORDER, constants.HOVER_TOOLTIP_BACKGROUND);
		assert.notEqual(constants.COLOR_DIFF_INSERTED_BACKGROUND, constants.COLOR_DIFF_REMOVED_BACKGROUND);
		assert.notEqual(constants.COLOR_DIFF_INSERTED_BACKGROUND, constants.COLOR_CODE_BACKGROUND);
		assert.notEqual(constants.COLOR_DIFF_REMOVED_BACKGROUND, constants.COLOR_CODE_BACKGROUND);
	}
});
