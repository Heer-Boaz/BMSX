import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { write_rect_bounds } from '../../machine/ts/common/rect';
import type { CartRomHeader } from '../../machine/ts/rompack/format';
import type { AssetType } from '../../machine/ts/rompack/toc';
import * as colors from '../../ide/common/constants';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { RomInspectorPresentation, drawRomInspector } from '../../ide/workbench/contrib/rom_inspector/presentation';
import { romInspectionSectionColor } from '../../ide/workbench/contrib/rom_inspector/colors';
import * as palette from '../../ide/theme/tokens';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../ide/editor/ui/inline/single_line_viewport';
import { layoutWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { api } from '../../ide/runtime/overlay_api';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { RectRenderKind, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { RomInspectionSection } from '../../toolchain/ts/rompack/inspection';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_symbols';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const ASSET_TYPES: readonly AssetType[] = ['image', 'texture', 'audio', 'data', 'bin', 'collision_shape', 'romlabel', 'model', 'aem', 'lua', 'code'];
const ASSET_COLORS: Record<AssetType, number> = {
	image: palette.THEME_TOKEN_ASSET_IMAGE, texture: palette.THEME_TOKEN_ASSET_TEXTURE,
	audio: palette.THEME_TOKEN_ASSET_AUDIO, data: palette.THEME_TOKEN_ASSET_DATA, bin: palette.THEME_TOKEN_ASSET_BINARY,
	collision_shape: palette.THEME_TOKEN_ASSET_COLLISION, romlabel: palette.THEME_TOKEN_ASSET_ROMLABEL,
	model: palette.THEME_TOKEN_ASSET_MODEL, aem: palette.THEME_TOKEN_ASSET_AEM,
	lua: palette.THEME_TOKEN_ASSET_LUA, code: palette.THEME_TOKEN_ASSET_CODE,
};
const SECTION_COLORS: Record<Exclude<RomInspectionSection['kind'], 'asset'>, number> = {
	header: palette.THEME_TOKEN_ROM_HEADER, manifest: palette.THEME_TOKEN_ROM_MANIFEST,
	toc: palette.THEME_TOKEN_ROM_TOC, metadata: palette.THEME_TOKEN_ROM_METADATA,
	blua32: palette.THEME_TOKEN_ROM_BLUA32, unreferenced: palette.THEME_TOKEN_ROM_UNREFERENCED,
};
const header: CartRomHeader = {
	headerSize: 72, manifestOffset: 72, manifestLength: 128,
	dataOffset: 512, dataLength: 3584, metadataOffset: 4096, metadataLength: 256, tocOffset: 4352, tocLength: 128,
	blua32ImageOffset: 200, blua32ImageByteCount: 256,
	blua32StartupFunctionAddress: 0, blua32IrqFunctionAddress: 0, blua32ExceptionFunctionAddress: 0,
	blua32StaticLayoutTokenLo: 0, blua32StaticLayoutTokenHi: 0, blua32DiagnosticDirectoryOffset: 0,
};

function fixture(t: TestContext) {
	const previous = { font: editorViewState.font, lineHeight: editorViewState.lineHeight }, previousTheme = colors.getActiveIdeThemeVariant();
	const assets: RomAsset[] = ASSET_TYPES.map((type, index) => ({ resid: type, type, start: 512 + index * 256, end: 704 + index * 256 }));
	assets[7].model_texture_start = 3328; assets[7].model_texture_end = 3520;
	assets[7].collision_bin_start = 3520; assets[7].collision_bin_end = 3712;
	assets.push({ resid: BLUA32_SYMBOLS_IMAGE_ID, type: 'bin', start: 3712, end: 3968 },
		{ resid: 'subpixel', type: 'bin', start: 3968, end: 3969 },
		{ resid: 'zero', type: 'bin', start: 3970, end: 3970 },
		{ resid: 'metadata-only', type: 'image', metabuffer_start: 4096, metabuffer_end: 4128 },
		{ resid: 'deleted', type: 'image', op: 'delete' });
	finalizePackedRomAssets(assets);
	const input = new RomInspectorInput({ domain: 0, label: 'Cart 0', rom: new Uint8Array(8192), header, assets });
	const presentation = new RomInspectorPresentation();
	const filter = new TextField(), filterViewport = new SingleLineFieldViewport(), overlay = createHostOverlayFixture(640, 288);
	const layout = (variant: 'tiny' | 'msx' = 'tiny', width = 384, left = 0) => {
		const font = new EditorFont(variant); editorViewState.font = font; editorViewState.lineHeight = font.lineHeight;
		Object.assign(input.layout, { left, top: 10, right: left + width, bottom: 280, rowHeight: font.lineHeight, font });
		write_rect_bounds(input.filterBounds, left + 40, 24, left + width - 4, 24 + font.lineHeight + 6);
		write_rect_bounds(input.mapBounds, left + 4, 46, left + width - 20, 52);
		input.list.layout(left + 2, 58, left + width * 0.42, 280, input.model.rows.length * (font.lineHeight * 2 + 4));
		input.bytes.layout(left + width * 0.42 + 4, 190, left + width - 2, 280, 100);
		layoutWorkbenchActionBar(input.actions, left + width - 4, 12, 16 + font.lineHeight, text => font.measure(text), font.renderFont(), left + 4);
		layoutWorkbenchActionBar(input.contentActions, left + width - 4, 176, 180 + font.lineHeight, text => font.measure(text), font.renderFont(), left + 4);
	};
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawRomInspector(input, presentation, filter, filterViewport); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), rects: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Rect) {
			const rect = frame.commandRefs[index] as RectRenderSubmission;
			if (rect.kind === RectRenderKind.Fill && rect.area.top === input.mapBounds.top && rect.area.bottom === input.mapBounds.bottom) rects.push(rect);
		}
		return rects;
	};
	layout();
	t.after(() => { input.dispose(); Object.assign(editorViewState, previous); colors.setIdeThemeVariant(previousTheme); });
	return { input, presentation, assets, layout, draw };
}

test('the actual ROM minimap distinguishes every typed asset payload rather than painting one generic asset color', t => {
	const f = fixture(t); f.presentation.update(f.input, true);
	const width = f.input.mapBounds.right - f.input.mapBounds.left;
	const payloadColors = ASSET_TYPES.map(type => {
		const asset = f.assets.find(asset => asset.resid === type)!;
		const left = f.input.mapBounds.left + Math.trunc(asset.start! / f.input.snapshot.rom.byteLength * width);
		return f.presentation.map.find(segment => segment.left === left)!.color;
	});
	assert.equal(new Set(payloadColors).size, ASSET_TYPES.length, 'all 11 real AssetTypes need distinct categorical map colors');
});

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) {
	test(`${theme}/${variant} section colors use typed payload, physical buffer and exact symbols identity`, t => {
		const f = fixture(t); colors.setIdeThemeVariant(theme); f.layout(variant);
		for (const type of ASSET_TYPES) {
			const asset = f.assets.find(asset => asset.resid === type)!;
			assert.equal(romInspectionSectionColor({ kind: 'asset', buffer: 'data', start: asset.start!, end: asset.end!, asset }), ASSET_COLORS[type]);
		}
		for (const kind of ['header', 'manifest', 'toc', 'metadata', 'blua32', 'unreferenced'] as const)
			assert.equal(romInspectionSectionColor({ kind, start: 0, end: 16 }), SECTION_COLORS[kind]);
		const model = f.assets.find(asset => asset.type === 'model')!;
		assert.equal(romInspectionSectionColor({ kind: 'asset', buffer: 'model-texture', asset: model, start: 3328, end: 3520 }), ASSET_COLORS.texture);
		assert.equal(romInspectionSectionColor({ kind: 'asset', buffer: 'collision', asset: model, start: 3520, end: 3712 }), ASSET_COLORS.collision_shape);
		const symbols = f.assets.find(asset => asset.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
		assert.equal(romInspectionSectionColor({ kind: 'asset', buffer: 'data', asset: symbols, start: 3712, end: 3968 }), palette.THEME_TOKEN_ROM_SYMBOLS);
		assert.equal(romInspectionSectionColor({ kind: 'asset', buffer: 'data', start: 0, end: 16,
			asset: { resid: BLUA32_SYMBOLS_IMAGE_ID + '.source', type: 'bin' } }), ASSET_COLORS.bin, 'similar text is not the exact retained symbols asset');
		const tokens = [...Object.values(ASSET_COLORS), ...Object.values(SECTION_COLORS), palette.THEME_TOKEN_ROM_SYMBOLS];
		assert.equal(new Set(tokens.map(palette.resolveThemeTokenColor)).size, 18, 'all category meanings retain distinct colors');
		for (const token of tokens) assert.equal(palette.resolveThemeTokenColor(token) >>> 24, 255, 'underlying content cannot change category ink');
	});
	test(`${theme}/${variant} actual map projection and paint retain proportional physical byte spans`, t => {
		const f = fixture(t); colors.setIdeThemeVariant(theme);
		const physical = f.input.model.inspection.sections, before = physical.map(section => ({ ...section }));
		assert.equal(physical.reduce((sum, section) => sum + section.end - section.start, 0), f.input.snapshot.rom.length);
		assert.ok(!physical.some(section => section.asset?.resid === 'metadata-only' || section.asset?.resid === 'deleted'),
			'logical metadata attribution and tombstones do not invent physical payload spans');
		assert.equal(physical.filter(section => section.kind === 'metadata').length, 1, 'shared metadata has exactly one physical section');
		for (const [width, left] of [[384, 0], [512, 13]] as const) {
			f.layout(variant, width, left); f.presentation.update(f.input, true);
			const map = f.input.mapBounds, mapWidth = map.right - map.left;
			const expected = physical.flatMap(section => {
				const left = map.left + Math.trunc(section.start / f.input.snapshot.rom.length * mapWidth);
				const right = map.left + Math.trunc(section.end / f.input.snapshot.rom.length * mapWidth);
				return right > left ? [{ left, right, color: romInspectionSectionColor(section) }] : [];
			});
			assert.deepEqual(f.presentation.map, expected);
			const rects = f.draw();
			assert.deepEqual(rects.map(rect => ({ left: rect.area.left, right: rect.area.right, color: rect.color })),
				expected.map(segment => ({ ...segment, color: palette.resolveThemeTokenColor(segment.color) })),
				'the actual renderer must consume retained section colors and original projected endpoints');
			assert.ok(f.presentation.map.every(segment => segment.right > segment.left));
			for (const resid of ['subpixel', 'zero']) {
				const section = physical.find(section => section.asset?.resid === resid)!;
				assert.equal(Math.trunc(section.start / f.input.snapshot.rom.length * mapWidth), Math.trunc(section.end / f.input.snapshot.rom.length * mapWidth),
					'a zero/subpixel physical span must not be promoted to an invented minimum-width segment');
			}
			assert.deepEqual(physical, before, 'layout and painting cannot mutate or double-count physical bytes');
		}
	});
}

test('idle, theme changes and table projections retain the existing physical map objects without remeasurement', t => {
	const f = fixture(t); f.presentation.update(f.input, true);
	const map = f.presentation.map, entries = map.slice(), values = map.map(segment => ({ ...segment }));
	const sections = f.input.model.inspection.sections;
	let measurements = 0;
	const font = editorViewState.font, measure = font.measure.bind(font), advance = font.advance.bind(font);
	t.mock.method(font, 'measure', (text: string) => { measurements++; return measure(text); });
	t.mock.method(font, 'advance', (text: string) => { measurements++; return advance(text); });
	for (let frame = 0; frame < 1000; frame++) f.presentation.update(f.input, false);
	assert.equal(measurements, 0);
	for (const theme of ['dark', 'light']) {
		colors.setIdeThemeVariant(theme); f.presentation.update(f.input, false);
		assert.equal(f.presentation.map, map); assert.deepEqual(map, values);
		assert.ok(map.every((segment, index) => segment === entries[index]));
		f.input.model.setMode('structure'); f.presentation.update(f.input, false);
		f.input.model.filter = 'audio'; f.input.model.project(); f.presentation.update(f.input, false);
		f.input.model.filter = ''; f.input.model.sort = 'size'; f.input.model.descending = true;
		f.input.model.setMode('assets'); f.input.model.project(); f.presentation.update(f.input, false);
		assert.equal(f.input.model.inspection.sections, sections);
		assert.equal(f.presentation.map, map); assert.deepEqual(map, values);
		assert.ok(map.every((segment, index) => segment === entries[index]));
	}
});
