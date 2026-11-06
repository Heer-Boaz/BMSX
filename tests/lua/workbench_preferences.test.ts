import { fontScaleForPixelSize } from '../../ide/editor/ui/view/font';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchPreferences, WORKBENCH_PREFERENCE_DEFAULTS } from '../../ide/workbench/services/preferences/preferences';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { fontEmSize, FONT_VARIANTS } from '../../machine/ts/render/shared/bmsx_font';
import { workbenchPixelsPerUnit } from '../../ide/workbench/common/display_scale';

test('font size is stored in pixels, independent of font family and project recovery', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	assert.equal(preferences.fontSize, 14);
	let changes = 0;
	const release = preferences.onDidChange(() => { changes++; });
	preferences.fontSize = 16.5; preferences.fontSize = 16.5;
	assert.equal(changes, 1);
	assert.equal(new WorkbenchPreferences(storage).fontSize, 16.5);
	assert.equal(new WorkbenchPreferences(new MemoryStorage()).fontSize, 14);
	preferences.fontVariant = 'tiny'; assert.equal(preferences.fontSize, 16.5);
	preferences.fontVariant = 'msx'; assert.equal(preferences.fontSize, 16.5);
	release(); const before = changes; preferences.fontSize = 12;
	assert.equal(changes, before);
	assert.equal(new WorkbenchPreferences(storage).fontSize, 12);
});

test('font sampling, family and theme persist without changing the pixel size', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	assert.equal(preferences.fontSampling, 'linear'); assert.equal(preferences.fontVariant, 'mono'); assert.equal(preferences.theme, 'light');
	let changes = 0;
	const release = preferences.onDidChange(() => changes++);
	preferences.fontSampling = 'nearest'; preferences.fontSampling = 'nearest';
	preferences.fontVariant = 'tiny'; preferences.fontVariant = 'tiny';
	preferences.theme = 'dark'; preferences.theme = 'dark';
	assert.equal(changes, 3);
	const restored = new WorkbenchPreferences(storage);
	assert.equal(restored.fontSampling, 'nearest'); assert.equal(restored.fontVariant, 'tiny'); assert.equal(restored.theme, 'dark');
	assert.equal(restored.fontSize, 14);
	release(); preferences.fontSampling = 'linear'; assert.equal(changes, 3);
});

test('obsolete percentage settings cannot rescale the pixel-size preference', () => {
	const storage = new MemoryStorage();
	storage.setItem('bmsx.studio.uiScale', '0.75'); storage.setItem('bmsx.studio.fontScales', '{"mono":2,"tiny":1,"msx":1}');
	assert.equal(new WorkbenchPreferences(storage).fontSize, 14);
});

test('reset removes user overrides before publishing the new effective defaults', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	preferences.fontSize = 18; preferences.theme = 'dark'; preferences.fontVariant = 'msx'; preferences.fontSampling = 'nearest';
	for (const key of ['fontSize', 'theme', 'fontVariant', 'fontSampling'] as const) {
		let changes = 0;
		const unbind = preferences.onDidChange(() => {
			changes++;
			assert.equal(preferences[key], WORKBENCH_PREFERENCE_DEFAULTS[key]);
			assert.equal(storage.getItem(`bmsx.studio.${key}`), null);
			assert.equal(preferences.isConfigured(key), false);
			assert.equal(new WorkbenchPreferences(storage)[key], preferences[key]);
		});
		preferences.reset(key); preferences.reset(key);
		assert.equal(changes, 1); unbind();
	}
});

test('an explicit default-value override remains resettable after reopening preferences', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	preferences.fontSize = 18; preferences.fontSize = WORKBENCH_PREFERENCE_DEFAULTS.fontSize;
	const reopened = new WorkbenchPreferences(storage);
	assert.equal(reopened.isConfigured('fontSize'), true);
	let changes = 0; reopened.onDidChange(() => changes++);
	reopened.reset('fontSize');
	assert.equal(reopened.isConfigured('fontSize'), false);
	assert.equal(storage.getItem('bmsx.studio.fontSize'), null);
	assert.equal(changes, 1);
});

test('font em size resolves to CSS pixels at desktop and compact widths', t => {
	configureFontVariant('mono');
	const previous = editorViewState.font;
	t.after(() => configureFontVariant(previous.variant, previous.sampling, previous.scale));
	for (const variant of FONT_VARIANTS) for (const width of [1920, 800, 390]) {
		const density = workbenchPixelsPerUnit(width);
		configureFontVariant(variant, 'linear', fontScaleForPixelSize(variant, 14, density));
		const font = editorViewState.font;
		assert.ok(Math.abs(font.scale * fontEmSize(variant) * density - 14) < 1e-10, 'nominal CSS em is independent of logical canvas density');
	}
});
