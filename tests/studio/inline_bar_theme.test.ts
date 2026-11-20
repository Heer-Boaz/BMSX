import assert from 'node:assert/strict';
import test from 'node:test';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { contrastRatio } from '../helpers/contrast.mjs';

for (const theme of ['light', 'dark']) test(`${theme} inline query and result text contrasts with its actual surface`, () => {
	colors.setIdeThemeVariant(theme);
	for (const [name, foreground, background] of [
		['query', colors.COLOR_SEARCH_TEXT, colors.COLOR_SEARCH_BACKGROUND],
		['result detail', colors.COLOR_SEARCH_SECONDARY_TEXT, colors.COLOR_SEARCH_BACKGROUND],
		['placeholder', colors.COLOR_SEARCH_PLACEHOLDER, colors.COLOR_SEARCH_BACKGROUND],
		['selected field text', colors.COLOR_SELECTION_TEXT, colors.SELECTION_OVERLAY],
		['selected result', colors.COLOR_SEARCH_SELECTION_TEXT, colors.SEARCH_RESULT_SELECTION_OVERLAY],
		['hovered result', colors.COLOR_SEARCH_HOVER_TEXT, colors.SEARCH_RESULT_HOVER_OVERLAY],
	] as const) {
		const ink = resolveThemeTokenColor(foreground), surface = resolveThemeTokenColor(background);
		assert.equal(ink >>> 24, 255); assert.equal(surface >>> 24, 255);
		const ratio = contrastRatio(ink, surface);
		assert.ok(ratio >= 4.5, `${theme} ${name}: ${ratio}:1`);
	}
});
