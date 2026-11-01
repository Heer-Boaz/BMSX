import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveIdeThemeVariant, setIdeThemeVariant } from '../../ide/common/constants';
import { ARTWORK_COLORS } from '../../ide/theme/artwork_colors';
import { resolveThemeTokenColor, THEME_TOKEN_BLACK, THEME_TOKEN_WHITE } from '../../ide/theme/tokens';
import { contrastRatio } from '../helpers/contrast.mjs';

test('the opaque artwork backdrop separates both black and white authored pixels', () => {
	const background = resolveThemeTokenColor(ARTWORK_COLORS.background);
	assert.equal(background >>> 24, 255);
	for (const foreground of [THEME_TOKEN_BLACK, THEME_TOKEN_WHITE])
		assert.ok(contrastRatio(resolveThemeTokenColor(foreground), background) >= 4.5);
});

test('artwork annotations own a readable opaque fill and distinct cased axes', () => {
	const annotation = ARTWORK_COLORS.annotation, background = resolveThemeTokenColor(annotation.background);
	assert.equal(background >>> 24, 255);
	for (const foreground of [annotation.foreground, annotation.warning]) {
		const color = resolveThemeTokenColor(foreground);
		assert.equal(color >>> 24, 255);
		assert.ok(contrastRatio(color, background) >= 4.5);
	}
	const axes = ARTWORK_COLORS.axes.map(resolveThemeTokenColor), casing = resolveThemeTokenColor(THEME_TOKEN_BLACK);
	assert.equal(new Set(axes).size, 3);
	for (const color of [...axes, resolveThemeTokenColor(ARTWORK_COLORS.active)]) {
		assert.equal(color >>> 24, 255);
		assert.ok(contrastRatio(color, casing) >= 3);
	}
});

test('switching UI themes does not recolor the artwork viewing roles', t => {
	const original = getActiveIdeThemeVariant();
	t.after(() => setIdeThemeVariant(original));
	const palette = { ...ARTWORK_COLORS, annotation: { ...ARTWORK_COLORS.annotation }, axes: [...ARTWORK_COLORS.axes] };
	const roles = [ARTWORK_COLORS.background, ARTWORK_COLORS.annotation.background,
		ARTWORK_COLORS.annotation.foreground, ARTWORK_COLORS.annotation.warning, ...ARTWORK_COLORS.axes, ARTWORK_COLORS.active];
	const colors = roles.map(resolveThemeTokenColor);
	for (const theme of ['light', 'dark']) {
		setIdeThemeVariant(theme);
		assert.deepEqual(ARTWORK_COLORS, palette);
		assert.deepEqual(roles.map(resolveThemeTokenColor), colors);
	}
});
