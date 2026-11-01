import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { SceneFontSource } from '../../ide/workbench/contrib/scene_editor/font_sources';
import type { SceneTextInputs, SceneTextRow } from '../../ide/workbench/contrib/scene_editor/text_source';
import { collectSceneTextImages, layoutSceneText } from '../../ide/workbench/contrib/scene_editor/viewport/text_layout';
import type { WorkspaceImageAsset } from '../../ide/workspace/image_assets';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';

function fixture(t: TestContext, dimensions: readonly (readonly [string, number, number])[]) {
	const bitmap = new HostBitmap({ width: 16, height: 16, pixels: new Uint8Array(16 * 16 * 4) });
	t.after(() => bitmap.dispose());
	const images = new Map<string, WorkspaceImageAsset>();
	for (const [id, width, height] of dimensions) images.set(id, { bitmap, width, height, u0: 0, v0: 0, u1: 1, v1: 1 });
	return { images, get: (id: string) => images.get(id) };
}

function row(codepoints: readonly number[], options: Partial<Omit<SceneTextRow, 'text'>> = {}): SceneTextRow {
	return { text: Uint32Array.from(codepoints), x: undefined, y: undefined, width: undefined, ...options };
}

function source(font: SceneFontSource, rows: readonly SceneTextRow[], options: Partial<Omit<SceneTextInputs, 'font' | 'rows'>> = {}): SceneTextInputs {
	return { font, rows, lineHeight: undefined, centerBlockWidth: undefined, backgroundColor: undefined, ...options };
}

// Coordinates here are the focused cartlib layout algorithm contract, not UI geometry snapshots.
test('codepoint glyphs use exact image regions, font fallback and trailing advance padding', t => {
	const assets = fixture(t, [['accent', 3, 7], ['rocket', 5, 9], ['fallback', 2, 4]]);
	const font: SceneFontSource = { glyphs: new Map([[0xe9, 'accent'], [0x1f680, 'rocket'], [0x3f, 'fallback']]), advancePadding: 1, lineHeight: 8 };
	const input = source(font, [row([0xe9, 0x1f680, 0x2603])], { centerBlockWidth: 15 });
	const used = new Set<string>(); collectSceneTextImages(input, used);
	assert.deepEqual(used, new Set(['accent', 'rocket', 'fallback']));
	const layout = layoutSceneText(input, assets)!;
	assert.deepEqual(layout.glyphs.map(glyph => [glyph.x, glyph.y]), [[1, 0], [5, 0], [11, 0]]);
	assert.equal(layout.glyphs[0].image, assets.images.get('accent'));
	assert.equal(layout.glyphs[1].image, assets.images.get('rocket'));
	assert.equal(layout.glyphs[2].image, assets.images.get('fallback'));
});

test('automatic tab draws the actual space image once and advances four padded spaces', t => {
	const assets = fixture(t, [['space', 3, 4], ['letter', 2, 6]]);
	const font: SceneFontSource = { glyphs: new Map([[0x20, 'space'], [0x41, 'letter']]), advancePadding: 2, lineHeight: 6 };
	const input = source(font, [row([0x09, 0x41, 0x20, 0x41])]);
	const used = new Set<string>(); collectSceneTextImages(input, used);
	assert.deepEqual(used, new Set(['space', 'letter']));
	const layout = layoutSceneText(input, assets)!;
	assert.deepEqual(layout.glyphs.map(glyph => glyph.x), [0, 20, 24, 29]);
	assert.equal(layout.glyphs[0].image, assets.images.get('space'));
	assert.equal(layout.glyphs[0].image.width, 3);
});

test('an explicit tab mapping has an ordinary advance and never admits the space image', t => {
	const assets = fixture(t, [['tab', 7, 4], ['letter', 2, 6]]);
	const font: SceneFontSource = { glyphs: new Map([[0x09, 'tab'], [0x20, 'space'], [0x41, 'letter']]), advancePadding: 2, lineHeight: 6 };
	const input = source(font, [row([0x09, 0x41])]);
	const used = new Set<string>(); collectSceneTextImages(input, used);
	assert.deepEqual(used, new Set(['tab', 'letter']));
	const layout = layoutSceneText(input, assets)!;
	assert.deepEqual(layout.glyphs.map(glyph => glyph.x), [0, 9]);
	assert.equal(layout.glyphs[0].image, assets.images.get('tab'));
});

test('an absent tab and space use the genuine question-mark fallback without a fabricated tab advance', t => {
	const assets = fixture(t, [['fallback', 3, 4]]);
	const font: SceneFontSource = { glyphs: new Map([[0x3f, 'fallback']]), advancePadding: 1, lineHeight: 4 };
	const layout = layoutSceneText(source(font, [row([0x09, 0x09])]), assets)!;
	assert.deepEqual(layout.glyphs.map(glyph => glyph.x), [0, 4]);
});

test('explicit row offsets win; centering uses explicit widths or full padded advances and BLua floor division', t => {
	const assets = fixture(t, [['letter', 4, 7]]);
	const font: SceneFontSource = { glyphs: new Map([[0x41, 'letter']]), advancePadding: 1, lineHeight: 7 };
	const input = source(font, [row([0x41], { x: 0, y: 0, width: 100 }), row([0x41], { width: 8 }), row([0x41]), row([0x41], { x: -3, y: -9 }), row([0x41], { width: 0 })],
		{ centerBlockWidth: 4, lineHeight: 0 });
	assert.deepEqual(layoutSceneText(input, assets)!.glyphs.map(glyph => [glyph.x, glyph.y]), [[0, 0], [-2, 0], [-1, 0], [-3, -9], [2, 0]]);
	const ordinary = source(font, [row([0x41]), row([]), row([0x41], { width: 100 })]);
	assert.deepEqual(layoutSceneText(ordinary, assets)!.glyphs.map(glyph => [glyph.x, glyph.y]), [[0, 0], [0, 14]]);
});

test('line height derives from A then a then question mark, selected by mapping presence', t => {
	const assets = fixture(t, [['upper', 2, 9], ['lower', 2, 7], ['fallback', 2, 5], ['letter', 3, 2]]);
	for (const [entries, expected, dependency] of [
		[[[0x41, 'upper'], [0x61, 'lower'], [0x3f, 'fallback']], 9, 'upper'],
		[[[0x61, 'lower'], [0x3f, 'fallback']], 7, 'lower'],
		[[[0x3f, 'fallback']], 5, 'fallback'],
	] as const) {
		const font: SceneFontSource = { glyphs: new Map<number, string>([...entries, [0x42, 'letter']]), advancePadding: 0, lineHeight: undefined };
		const input = source(font, [row([0x42]), row([0x42])]);
		const used = new Set<string>(); collectSceneTextImages(input, used);
		assert.deepEqual(used, new Set([dependency, 'letter']));
		const layout = layoutSceneText(input, assets)!;
		assert.ok(layout.glyphs[0].y === 0); assert.equal(layout.glyphs[1].y, expected);
	}
});

test('authored and font line heights do not require unused line glyph images', t => {
	const assets = fixture(t, [['letter', 3, 2]]);
	for (const [lineHeight, fontHeight, expected] of [[-3, 10, -3], [undefined, 0, 0], [undefined, 10, 10]] as const) {
		const font: SceneFontSource = { glyphs: new Map([[0x41, 'missing'], [0x42, 'letter']]), advancePadding: 0, lineHeight: fontHeight };
		const input = source(font, [row([0x42]), row([0x42])], { lineHeight });
		const used = new Set<string>(); collectSceneTextImages(input, used);
		assert.deepEqual(used, new Set(['letter']));
		const layout = layoutSceneText(input, assets)!;
		assert.ok(layout.glyphs[0].y === 0); assert.equal(layout.glyphs[1].y, expected);
	}
});

test('missing mapped assets leave the entire layout unresolved without selecting another glyph', t => {
	const assets = fixture(t, [['lower', 3, 7], ['fallback', 2, 5]]);
	const font: SceneFontSource = { glyphs: new Map([[0x41, 'missing'], [0x61, 'lower'], [0x3f, 'fallback']]), advancePadding: 0, lineHeight: undefined };
	const input = source(font, [row([0x61])]);
	const used = new Set<string>(); collectSceneTextImages(input, used);
	assert.deepEqual(used, new Set(['missing', 'lower']));
	assert.equal(layoutSceneText(input, assets), undefined, 'A is selected for line height even though a and ? assets are available');
	assert.equal(layoutSceneText(source({ ...font, lineHeight: 7 }, [row([0x61, 0x41])]), assets), undefined,
		'a missing mapped glyph cannot fall back to the available question-mark asset or return a partial row');
	assert.equal(layoutSceneText(source({ ...font, lineHeight: 7, glyphs: new Map([[0x61, 'lower']]) }, [row([0x61, 0x2603])]), assets), undefined,
		'a font with no question mark cannot fabricate a fallback glyph');
	assert.equal(layoutSceneText(source({ ...font, lineHeight: 7, glyphs: new Map([[0x09, 'missing'], [0x20, 'lower'], [0x3f, 'fallback']]) }, [row([0x09])]), assets), undefined,
		'a missing explicit tab asset cannot select the available space image');
});

test('zero codepoints and negative advance padding remain ordinary deterministic font data', t => {
	const assets = fixture(t, [['zero', 3, 5], ['letter', 2, 5]]);
	const font: SceneFontSource = { glyphs: new Map([[0, 'zero'], [0x41, 'letter']]), advancePadding: -4, lineHeight: 5 };
	const input = source(font, [row([0, 0x41, 0])]);
	const used = new Set<string>(); collectSceneTextImages(input, used);
	assert.deepEqual(used, new Set(['zero', 'letter']));
	assert.deepEqual(layoutSceneText(input, assets)!.glyphs.map(glyph => glyph.x), [0, -1, -3]);
});

test('layout only borrows bitmap assets and retains no ownership callbacks', t => {
	const assets = fixture(t, [['letter', 3, 5]]), image = assets.images.get('letter')!;
	const released = t.mock.fn(); image.bitmap.onDispose(released);
	const subscribe = t.mock.method(image.bitmap, 'onDispose');
	const font: SceneFontSource = { glyphs: new Map([[0x41, 'letter']]), advancePadding: 0, lineHeight: 5 };
	const input = source(font, [row([0x41])]), layout = layoutSceneText(input, assets)!;
	assert.equal(layout.glyphs[0].image, image); assert.equal(subscribe.mock.callCount(), 0); assert.equal(released.mock.callCount(), 0);
});
