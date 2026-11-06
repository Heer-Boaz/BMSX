import assert from 'node:assert/strict';
import test from 'node:test';
import { BFont, TAB_SPACES, type BitmapFontSource, type FontRendering } from '../../machine/ts/render/shared/bitmap_font';
import { Font } from '../../machine/ts/render/shared/bmsx_font';

function sourceFixture() {
	const resolutions = new Map<string, number>();
	const source: BitmapFontSource = {
		atlas: { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]), srgb: false },
		resolveGlyph(id) {
			resolutions.set(id, (resolutions.get(id) ?? 0) + 1);
			return { width: 1, height: 2, advance: 3, offsetX: -0.5, offsetY: 0.25, u: 0, v: 0, w: 1, h: 1 };
		},
	};
	return { source, resolutions };
}

for (const rendering of [{ raster: 'bitmap', sampling: 'nearest' }, { raster: 'msdf', lineHeight: 4, distanceRange: 2 }] as const satisfies readonly FontRendering[]) {
	test(`${rendering.raster}: glyph storage follows source ids, not the set of characters encountered`, () => {
		const { source, resolutions } = sourceFixture();
		const font = new BFont(source, { A: 'letter', a: 'letter', '?': 'question', ' ': 'space' }, 1, rendering);
		const upper = font.getGlyph('A'), lower = font.getGlyph('a'), missing = font.getGlyph('?');
		assert.ok(upper === lower, 'aliases share their source glyph, including bearings and advance');
		assert.equal(resolutions.get('letter'), 1);
		for (let codepoint = 0x10000; codepoint < 0x11000; codepoint++) {
			assert.ok(font.getGlyph(String.fromCodePoint(codepoint)) === missing, 'unsupported characters do not allocate new glyph records');
		}
		assert.equal(resolutions.get('question'), 1, 'missing characters never re-resolve the same source image');
		assert.equal(font.advance('A'), 4, 'face-specific advance padding is applied once');
		const space = font.getGlyph(' '), tab = font.getGlyph('\t');
		assert.ok(tab !== space, 'synthetic tab geometry is not a second source glyph');
		assert.ok(tab === font.getGlyph('\t'));
		assert.equal(tab.advance, space.advance * TAB_SPACES);
		assert.equal(tab.width, tab.advance);
		assert.equal(tab.offsetX, space.offsetX); assert.equal(tab.offsetY, space.offsetY);
		assert.equal(resolutions.get('space'), 1);
		assert.deepEqual([...resolutions.values()], [1, 1, 1]);
	});
}

test('an explicitly mapped tab uses its source glyph and font instances retain their own metrics', () => {
	const { source, resolutions } = sourceFixture();
	const map = { A: 'letter', '?': 'question', ' ': 'space', '\t': 'letter' };
	const a = new BFont(source, map), b = new BFont(source, map, 2);
	assert.ok(a.getGlyph('\t') === a.getGlyph('A'));
	assert.ok(a.getGlyph('A') !== b.getGlyph('A'), 'a cache must not leak adjusted advances between font instances');
	assert.equal(b.advance('A') - a.advance('A'), 2);
	assert.equal(resolutions.get('letter'), 2);
});

test('unknown character lookup does not grow either resource or character indexes', t => {
	const { source } = sourceFixture();
	const font = new BFont(source, { A: 'letter', '?': 'question', ' ': 'space' });
	font.getGlyph('?');
	// Observe cache writes without exposing font internals or allocating a heap snapshot.
	// The synchronous loop admits no new font resources or character bindings.
	const writes = t.mock.method(Map.prototype, 'set');
	for (let codepoint = 0x10000; codepoint < 0x11000; codepoint++) font.getGlyph(String.fromCodePoint(codepoint));
	writes.mock.restore();
	assert.equal(writes.mock.callCount(), 0);
});

for (const variant of ['mono', 'tiny', 'msx'] as const) for (const style of ['normal', 'italic'] as const) {
	test(`${variant}/${style}: known aliases and missing characters reuse font-owned glyphs`, () => {
		const font = new Font({ variant, style }), seen = new Map<string, ReturnType<Font['getGlyph']>>();
		for (const char of Object.keys(font.itemMap)) {
			const glyph = font.getGlyph(char), previous = seen.get(glyph.imgid);
			if (previous) assert.ok(glyph === previous);
			else seen.set(glyph.imgid, glyph);
		}
		const missing = font.getGlyph('?');
		for (let codepoint = 0x10000; codepoint < 0x10100; codepoint++) assert.ok(font.getGlyph(String.fromCodePoint(codepoint)) === missing);
	});
}
