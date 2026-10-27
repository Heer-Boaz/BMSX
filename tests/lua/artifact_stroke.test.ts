import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../../ide/runtime/overlay_api';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostOverlayQuadStream, HOST_OVERLAY_INSTANCE_FLOATS } from '../../machine/ts/render/host_overlay/quad_stream';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import type { PolyRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import * as colors from '../../ide/common/constants';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../ide/editor/ui/inline/single_line_viewport';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { RomInspectorPresentation, drawRomInspector } from '../../ide/workbench/contrib/rom_inspector/presentation';
import { RomInspectorContentPresentation, drawRomInspectorContent } from '../../ide/workbench/contrib/rom_inspector/content_presentation';
import { layoutWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { write_rect_bounds } from '../../machine/ts/common/rect';
import type { CartRomHeader } from '../../machine/ts/rompack/format';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeDirect16GxUpload } from '../../toolchain/ts/rompack/gp0_encode';
import { encodeCollisionShapeVariants, type CollisionShapeVariant } from '../../toolchain/ts/rompack/collision_shape_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from '../../toolchain/ts/rompack/system_texture';

const header: CartRomHeader = { headerSize: 72, manifestOffset: 72, manifestLength: 0,
	dataOffset: 72, dataLength: 256, metadataOffset: 328, metadataLength: 0, tocOffset: 328, tocLength: 0,
	blua32ImageOffset: 0, blua32ImageByteCount: 0, blua32StartupFunctionAddress: 0, blua32IrqFunctionAddress: 0,
	blua32ExceptionFunctionAddress: 0, blua32StaticLayoutTokenLo: 0, blua32StaticLayoutTokenHi: 0, blua32DiagnosticDirectoryOffset: 0 };

function frame(draw: () => void, fixture = createHostOverlayFixture(64, 48)) {
	fixture.renderer.beginFrame(fixture.presenter); api.beginFrame(fixture.renderer); draw(); fixture.renderer.endFrame();
	return fixture.queue.consumeOverlayFrame();
}

test('an artifact path publishes one immutable geometry snapshot with black casing before white core', () => {
	const source = [0.25, 2, 12, 2], f = createHostOverlayFixture(64, 48);
	const output = frame(() => api.outlinedPolyline(source, 4, 6, 3), f);
	assert.equal(output.commandCount, 2); assert.deepEqual(output.commandKinds.slice(0, 2), [Host2DKind.Poly, Host2DKind.Poly]);
	const outer = output.commandRefs[0] as PolyRenderSubmission, core = output.commandRefs[1] as PolyRenderSubmission;
	assert.equal(outer.points, core.points); assert.notEqual(outer.points, source);
	assert.deepEqual(outer.points, [4.25, 8, 16, 8]); assert.equal(outer.z, 3); assert.equal(core.z, 3);
	assert.deepEqual([outer.thickness, outer.color, core.thickness, core.color], [3, 0xff000000, 1, 0xffffffff]);
	source[0] = 100; assert.equal(outer.points[0], 4.25, 'the published route does not borrow mutable feature storage');
});

test('geometry pools cannot alias earlier strokes when outlined and ordinary polyline submission orders change', () => {
	const f = createHostOverlayFixture(64, 48);
	const first = frame(() => { api.outlinedPolyline([1, 2, 3, 4], 0, 0, 0); api.polyline([10, 20, 30, 40], 0, 0, 0, 2, colors.COLOR_RESOURCE_VIEWER_TEXT); }, f);
	const firstOuter = first.commandRefs[0] as PolyRenderSubmission, firstCore = first.commandRefs[1] as PolyRenderSubmission;
	const firstSecond = first.commandRefs[2] as PolyRenderSubmission, firstGeometry = firstOuter.points;
	frame(() => api.outlinedPolyline([9, 8, 7, 6], 0, 0, 0), f);
	assert.deepEqual(firstOuter.points, [1, 2, 3, 4], 'the standby frame stays immutable until its buffer is reused');
	assert.deepEqual(firstSecond.points, [10, 20, 30, 40]);
	const third = frame(() => { api.polyline([11, 12, 13, 14], 0, 0, 0, 1, colors.COLOR_RESOURCE_VIEWER_TEXT); api.outlinedPolyline([21, 22, 23, 24], 0, 0, 0); api.outlinedPolyline([31, 32, 33, 34], 0, 0, 0); }, f);
	const paths = third.commandRefs.slice(0, third.commandCount) as PolyRenderSubmission[];
	assert.equal(paths[0], firstOuter); assert.equal(paths[1], firstCore); assert.equal(paths[0].points, firstGeometry);
	assert.deepEqual(paths.map(path => path.points), [[11, 12, 13, 14], [21, 22, 23, 24], [21, 22, 23, 24], [31, 32, 33, 34], [31, 32, 33, 34]]);
	assert.equal(paths[1].points, paths[2].points); assert.equal(paths[3].points, paths[4].points);
	assert.notEqual(paths[0].points, paths[1].points); assert.notEqual(paths[1].points, paths[3].points);
});

test('outlined rectangles snapshot exact subpixel corners and do not borrow the reusable rectangle scratch', () => {
	const output = frame(() => { api.outlinedRect(7.25, 3, 7.375, 11, 0); api.outlinedRect(20, 21, 22, 23, 0); });
	const paths = output.commandRefs.slice(0, output.commandCount) as PolyRenderSubmission[];
	assert.deepEqual(paths[0].points, [7.25, 3, 7.375, 3, 7.375, 11, 7.25, 11, 7.25, 3]);
	assert.equal(paths[0].points, paths[1].points);
	assert.deepEqual(paths[2].points, [20, 21, 22, 21, 22, 23, 20, 23, 20, 21]);
	assert.notEqual(paths[0].points, paths[2].points);
});

for (const scale of [0.5, 1, 4]) test(`artifact stroke widths stay in screen space under ${scale}x view zoom`, () => {
	const output = frame(() => { api.pushClipRect(2, 3, 62, 45); api.pushTransform({ scale, offsetX: 4, offsetY: 5 }); api.outlinedPolyline([2, 4, 10, 4], 0, 0, 0); api.popTransform(); api.popClipRect(); });
	const stream = new HostOverlayQuadStream(); stream.reset(64, 48);
	for (let index = 0; index < output.commandCount; index++) stream.appendEntry(output.commandKinds[index], output.commandRefs[index]);
	assert.equal(stream.count, 2);
	assert.equal(stream.floatData[2], 8 * scale); assert.equal(stream.floatData[5], 3);
	assert.equal(stream.floatData[HOST_OVERLAY_INSTANCE_FLOATS + 5], 1);
	assert.equal(stream.floatData[0], 2 * scale + 4); assert.equal(stream.floatData[1], 4 * scale + 5 - 1.5);
	assert.deepEqual(stream.batches[0].clip, { left: 2, top: 3, right: 62, bottom: 45 });
});

test('black and white artifact evidence is rendered over arbitrary bitmap colors without reading those pixels', t => {
	const f = createHostOverlayFixture(64, 48), pixels = new Uint8Array(64 * 48 * 4);
	for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) pixels.set(x < 32 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 64 + x) * 4);
	const bitmap = new HostBitmap({ width: 64, height: 48, pixels }); t.after(() => bitmap.dispose());
	const output = frame(() => { api.drawBitmap(bitmap, 0, 0, 64, 48); api.outlinedPolyline([4, 20, 60, 20], 0, 0, 0); }, f);
	const target = new Uint8Array(pixels.length), context = f.backend.hostOverlayContext;
	beginHeadlessHost2D(context, target, 64, 48);
	for (let index = 0; index < output.commandCount; index++) renderHeadlessHost2DEntry(context, output.commandKinds[index], output.commandRefs[index]);
	for (const x of [16, 48]) {
		assert.deepEqual(Array.from(target.subarray((20 * 64 + x) * 4, (20 * 64 + x) * 4 + 4)), [255, 255, 255, 255]);
		assert.deepEqual(Array.from(target.subarray((19 * 64 + x) * 4, (19 * 64 + x) * 4 + 4)), [0, 0, 0, 255]);
	}
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) test(`${variant}/${theme} selected ROM byte ranges keep their real subpixel map width`, t => {
	const previousFont = editorViewState.font, previousHeight = editorViewState.lineHeight, previousTheme = colors.getActiveIdeThemeVariant();
	const font = new EditorFont(variant); editorViewState.font = font; editorViewState.lineHeight = font.lineHeight; colors.setIdeThemeVariant(theme);
	const assets: RomAsset[] = [{ resid: 'one-byte', type: 'bin', start: 128, end: 129 }]; finalizePackedRomAssets(assets);
	const input = new RomInspectorInput({ domain: 0, sourceContextId: TEST_CARTRIDGE_CONTEXT_IDS[0], label: 'Captured ROM', rom: new Uint8Array(512), header, assets });
	t.after(() => { input.dispose(); editorViewState.font = previousFont; editorViewState.lineHeight = previousHeight; colors.setIdeThemeVariant(previousTheme); });
	input.model.setMode('assets'); input.model.select(input.model.rows.findIndex(row => row.asset === assets[0]));
	Object.assign(input.layout, { left: 0, top: 10, right: 128, bottom: 120, rowHeight: font.lineHeight, font });
	write_rect_bounds(input.mapBounds, 4, 40, 104, 46); write_rect_bounds(input.filterBounds, 32, 24, 124, 36);
	input.list.layout(4, 52, 124, 120, 20); layoutWorkbenchActionBar(input.actions, 124, 10, 22, text => font.measure(text), font.renderFont(), 4);
	const presentation = new RomInspectorPresentation(); presentation.update(input, true);
	const filter = new TextField(), filterViewport = new SingleLineFieldViewport();
	filterViewport.layout(filter, input.filterBounds, { advanceChar: char => font.advance(char), spaceAdvance: font.advance(' '), tabSpaces: 4 }, font);
	const output = frame(() => drawRomInspector(input, presentation, filter, filterViewport, true));
	const paths: PolyRenderSubmission[] = [];
	for (let index = 0; index < output.commandCount; index++) if (output.commandKinds[index] === Host2DKind.Poly) paths.push(output.commandRefs[index] as PolyRenderSubmission);
	assert.equal(paths.length, 2); const span = presentation.selectedSpans[0];
	assert.ok(span.right - span.left < 1); assert.equal(span.right - span.left, 100 / 512);
	assert.deepEqual(paths[0].points, [span.left, 40, span.right, 40, span.right, 46, span.left, 46, span.left, 40]);
	assert.equal(paths[0].points, paths[1].points); assert.deepEqual([paths[0].color, paths[1].color], [0xff000000, 0xffffffff]);
});

test('captured image collision renders both its decoded bounding box and all actual decoded paths', t => {
	const pixels = Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255);
	const texture = encodeDirect16GxTexture(2, 2, pixels), upload = encodeDirect16GxUpload(texture, 0, 0);
	const shape: CollisionShapeVariant = { bounds: { left: 0, top: 0, right: 1, bottom: 1 },
		pieces: [{ kind: 'convex_poly', vertices: [0, 0, 1, 0, 1, 1] }] };
	const collision = encodeCollisionShapeVariants({ original: shape, fliph: shape, flipv: shape, fliphv: shape });
	const collisionStart = 72 + upload.length, collisionEnd = collisionStart + collision.length;
	const rom = new Uint8Array(collisionEnd + 16); rom.set(upload, 72); rom.set(collision, collisionStart);
	const assets: RomAsset[] = [
		{ resid: GX_SYSTEM_TEXTURE_ASSET_ID, type: 'bin', start: 72, end: collisionStart },
		{ resid: 'sprite', type: 'image', metabuffer_start: collisionEnd, metabuffer_end: collisionEnd + 16,
			collision_bin_start: collisionStart, collision_bin_end: collisionEnd,
			imgmeta: { width: 2, height: 2, texture_u: 0, texture_v: 0 } },
	];
	finalizePackedRomAssets(assets);
	const input = new RomInspectorInput({ domain: 0, sourceContextId: TEST_CARTRIDGE_CONTEXT_IDS[0], label: 'Captured image', rom, assets,
		header: { ...header, dataLength: collisionEnd - 72, metadataOffset: collisionEnd, metadataLength: 16, tocOffset: rom.length } });
	t.after(() => input.dispose());
	input.model.select(input.model.rows.findIndex(row => row.asset === assets[1]));
	const document = input.reader; document.setSubject(input.model.selection); document.setView('preview'); document.preparePreview(); document.showCollision = true;
	assert.deepEqual(document.collision, shape); assert.deepEqual(document.collisionPaths, [[0, 0, 1, 0, 1, 1, 0, 0]]);
	document.imageView.layout(0, 0, 32, 32);
	const originalPaths = document.collisionPaths.map(path => path.slice());
	const output = frame(() => drawRomInspectorContent(input, new RomInspectorContentPresentation(), new EditorFont('tiny').renderFont()));
	const paths: PolyRenderSubmission[] = [];
	for (let index = 0; index < output.commandCount; index++) if (output.commandKinds[index] === Host2DKind.Poly) paths.push(output.commandRefs[index] as PolyRenderSubmission);
	assert.equal(paths.length, 4);
	assert.deepEqual(paths[0].points, [0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);
	assert.deepEqual(paths[2].points, originalPaths[0]);
	assert.equal(paths[0].points, paths[1].points); assert.equal(paths[2].points, paths[3].points);
	assert.notEqual(paths[0].points, paths[2].points);
	assert.deepEqual(paths.map(path => [path.thickness, path.color]), [[3, 0xff000000], [1, 0xffffffff], [3, 0xff000000], [1, 0xffffffff]]);
	assert.deepEqual(document.collisionPaths, originalPaths); assert.deepEqual(document.preview!.image.pixels, new Uint8Array(pixels));
});
