import assert from 'node:assert/strict';
import test from 'node:test';
import * as constants from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';

test('hover text and its opaque surface keep enhanced text contrast in both IDE themes', () => {
	for (const theme of ['dark', 'light']) {
		constants.setIdeThemeVariant(theme);
		const colors = [constants.HOVER_TOOLTIP_TEXT, constants.HOVER_TOOLTIP_BACKGROUND].map(resolveThemeTokenColor);
		for (const color of colors) assert.equal(color >>> 24, 255, 'underlying source cannot change the text/surface contrast');
		// WCAG relative luminance in linear sRGB, not a brightness heuristic.
		const luminances = colors.map(color => {
			const rgb = [color >>> 16 & 255, color >>> 8 & 255, color & 255]
				.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
			return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
		});
		const contrast = (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
		assert.ok(contrast >= 7, `${theme} hover contrast is ${contrast}:1`);
		assert.notEqual(constants.HOVER_TOOLTIP_BORDER, constants.HOVER_TOOLTIP_BACKGROUND);
	}
});
