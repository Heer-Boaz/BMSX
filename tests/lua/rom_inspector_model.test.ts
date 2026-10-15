import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RomInspectorModel } from '../../ide/workbench/contrib/rom_inspector/model';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { parseCartHeader, type CartRomHeader } from '../../machine/ts/rompack/format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeCollisionShapeVariants, type CollisionShapeVariant } from '../../toolchain/ts/rompack/collision_shape_codec';
import { encodeDirect16GxUpload } from '../../toolchain/ts/rompack/gp0_encode';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from '../../toolchain/ts/rompack/system_texture';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

const header: CartRomHeader = {
	headerSize: 72,
	manifestOffset: 0, manifestLength: 0,
	tocOffset: 176, tocLength: 16,
	metadataOffset: 144, metadataLength: 32,
	dataOffset: 72, dataLength: 72,
	blua32ImageOffset: 0, blua32ImageByteCount: 0,
	blua32StartupFunctionAddress: 0,
	blua32IrqFunctionAddress: 0,
	blua32ExceptionFunctionAddress: 0,
	blua32StaticLayoutTokenLo: 0,
	blua32StaticLayoutTokenHi: 0,
	blua32DiagnosticDirectoryOffset: 0,
};

const modelAsset: RomAsset = {
	resid: 'model', type: 'model', source_path: 'res/model.glb',
	start: 72, end: 88,
	model_texture_start: 88, model_texture_end: 104,
	collision_bin_start: 104, collision_bin_end: 128,
	metabuffer_start: 144, metabuffer_end: 160,
};

function inspector(assets: RomAsset[]): RomInspectorModel {
	finalizePackedRomAssets(assets);
	return new RomInspectorModel({ domain: 0, label: 'Cart 0', rom: new Uint8Array(192), header, assets });
}

test('asset content selects every retained physical range without replacing its source context', () => {
	const model = inspector([modelAsset]);
	const row = model.selection!;
	assert.deepEqual(model.ranges.map(range => [range.kind, range.start, range.end]), [
		['data', 72, 88], ['metadata', 144, 160], ['model-texture', 88, 104], ['collision', 104, 128],
	]);
	assert.strictEqual(model.ranges, row.ranges);
	assert.strictEqual(model.selectedRange, model.ranges[0]);
	assert.equal(row.byteLength, 72);
	assert.equal(model.canPreviewImage, false);
	for (let index = 0; index < model.ranges.length; index++) {
		model.selectRange(index);
		assert.strictEqual(model.selectedRange, model.ranges[index]);
		assert.strictEqual(model.selection, row);
		assert.equal(model.selection.sourcePath, 'res/model.glb');
	}
	assert.equal(modelAsset.buffer, undefined);
});

test('range selection survives filtering and sorting of the same row and resets for another asset', () => {
	const bin: RomAsset = { resid: 'bin', type: 'bin', start: 128, end: 144 };
	const model = inspector([bin, modelAsset]);
	model.select(model.rows.findIndex(row => row.asset === modelAsset));
	model.selectRange(3);
	const range = model.selectedRange;
	model.sort = 'size'; model.descending = true; model.project();
	assert.equal(model.selected, 0);
	assert.strictEqual(model.selectedRange, range);
	model.filter = 'model.glb'; model.project();
	assert.strictEqual(model.selectedRange, range);
	model.filter = ''; model.project();
	assert.strictEqual(model.selectedRange, range);
	model.select(model.rows.findIndex(row => row.asset === bin));
	assert.strictEqual(model.selectedRange, model.ranges[0]);
	model.select(model.rows.findIndex(row => row.asset === modelAsset));
	assert.equal(model.selectedRange.kind, 'data');
	model.filter = 'no matching asset'; model.project();
	assert.equal(model.selection, undefined);
	assert.deepEqual(model.ranges, []);
	assert.equal(model.selectedRange, undefined);
	assert.equal(model.canPreviewImage, false);
});

test('metadata-only images have metadata bytes, while deletion operations never request a preview', () => {
	const sprite: RomAsset = {
		resid: 'sprite', type: 'image', metabuffer_start: 160, metabuffer_end: 176,
		imgmeta: { width: 4, height: 4, texture_u: 0, texture_v: 0, gx_atlas_id: 'atlas' },
	};
	const tombstones: RomAsset[] = [
		{ resid: 'removed image', type: 'image', op: 'delete' },
		{ resid: 'removed texture', type: 'texture', op: 'delete' },
	];
	const model = inspector([sprite, ...tombstones]);
	model.select(model.rows.findIndex(row => row.asset === sprite));
	assert.equal(model.canPreviewImage, true);
	assert.equal(model.selectedRange.kind, 'metadata');
	for (const tombstone of tombstones) {
		model.select(model.rows.findIndex(row => row.asset === tombstone));
		assert.equal(model.canPreviewImage, false);
		assert.deepEqual(model.ranges, []);
		assert.equal(model.selectedRange, undefined);
		assert.equal(model.selection.asset.op, 'delete');
	}
});

test('Layout keeps its selected physical section instead of opening the asset primary payload', () => {
	const model = inspector([modelAsset]);
	model.setMode('structure');
	assert.deepEqual(model.selectedRange, { kind: 'header', start: 0, end: 72 });
	model.select(model.rows.findIndex(row => row.start === 88));
	assert.strictEqual(model.selection.asset, modelAsset);
	assert.deepEqual(model.ranges, [{ kind: 'model-texture', start: 88, end: 104 }]);
	assert.equal(model.canPreviewImage, false);
});

test('empty code filters and non-code selections release instruction indexes and reselecting reindexes', () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 1, 2, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, 0, 0, 0);
	const linked = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 3 },
	] });
	const model = new RomInspectorModel({ domain: -1, label: 'System', rom: linked.romBytes, header: parseCartHeader(linked.romBytes), assets: [] });
	model.setMode('code');
	model.select(model.rows.findIndex(row => row.functionIndex === 1));
	const expected = [linked.image.functions[1].codeAddress, linked.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES];
	assert.deepEqual([...model.instructions], expected);
	assert.equal(model.selectedRange.kind, 'instructions');
	model.filter = 'no matching function'; model.project();
	assert.equal(model.instructions.length, 0);
	assert.equal(model.selectedRange, undefined);
	model.filter = ''; model.project();
	model.select(model.rows.findIndex(row => row.functionIndex === 1));
	assert.deepEqual([...model.instructions], expected);
	model.setMode('structure');
	assert.equal(model.instructions.length, 0);
	assert.equal(model.selectedRange.kind, 'header');
});

test('preview changes retain decoded pixels and collision paths until selection changes', t => {
	const pixels = Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255);
	const texture = encodeDirect16GxTexture(2, 2, pixels);
	const upload = encodeDirect16GxUpload(texture, 0, 0);
	const shape: CollisionShapeVariant = {
		bounds: { left: 0, top: 0, right: 1, bottom: 1 },
		pieces: [{ kind: 'convex_poly', vertices: [0, 0, 1, 0, 1, 1] }],
	};
	const collisionBytes = encodeCollisionShapeVariants({ original: shape, fliph: shape, flipv: shape, fliphv: shape });
	const collisionStart = 72 + upload.length;
	const collisionEnd = collisionStart + collisionBytes.length;
	const fixtureHeader = { ...header, dataLength: collisionEnd - 72, metadataOffset: collisionEnd, tocOffset: collisionEnd + 32 };
	const rom = new Uint8Array(fixtureHeader.tocOffset + fixtureHeader.tocLength);
	rom.set(upload, 72);
	rom.set(collisionBytes, collisionStart);
	const systemTexture: RomAsset = { resid: GX_SYSTEM_TEXTURE_ASSET_ID, type: 'bin', start: 72, end: 72 + upload.length };
	const sprite: RomAsset = {
		resid: 'sprite', type: 'image', metabuffer_start: collisionEnd, metabuffer_end: collisionEnd + 16,
		collision_bin_start: collisionStart, collision_bin_end: collisionEnd,
		imgmeta: { width: 2, height: 2, texture_u: 0, texture_v: 0 },
	};
	const second: RomAsset = { resid: 'second', type: 'image', metabuffer_start: collisionEnd + 16, metabuffer_end: collisionEnd + 32,
		imgmeta: { width: 1, height: 2, texture_u: 1, texture_v: 0 } };
	const removed: RomAsset = { resid: 'removed', type: 'image', op: 'delete' };
	const entries = [systemTexture, sprite, second, removed];
	finalizePackedRomAssets(entries);
	const input = new RomInspectorInput({ domain: -1, label: 'System', rom, header: fixtureHeader, assets: entries });
	t.after(() => input.dispose());
	input.model.select(input.model.rows.findIndex(row => row.asset === sprite));
	input.updatePreview();
	const bitmap = input.preview!;
	const release = t.mock.method(bitmap, 'dispose');
	const paths = input.collisionPaths;
	const collision = input.collision;
	assert.deepEqual(bitmap.image.pixels, new Uint8Array(pixels));
	assert.deepEqual(collision, shape);
	assert.deepEqual(paths, [[0, 0, 1, 0, 1, 1, 0, 0]]);
	assert.equal(input.hasCollision, true);
	input.model.sort = 'size'; input.model.descending = true; input.model.project();
	input.updatePreview();
	input.contentMode = 'bytes'; input.model.selectRange(1); input.updatePreview();
	assert.equal(input.model.selectedRange.kind, 'collision');
	assert.equal(input.showingImage, false);
	input.contentMode = 'preview'; input.updatePreview();
	input.imageView.layout(0, 0, 80, 64);
	input.imageView.setScale(16);
	input.imageView.pan(8, 8);
	input.showCollision = true;
	input.updatePreview();
	assert.equal(input.showingImage, true);
	assert.strictEqual(input.preview, bitmap);
	assert.strictEqual(input.collisionPaths, paths);
	assert.strictEqual(input.collision, collision);
	assert.equal(release.mock.callCount(), 0);
	input.model.select(input.model.rows.findIndex(row => row.asset === second));
	input.updatePreview();
	assert.equal(release.mock.callCount(), 1);
	assert.notStrictEqual(input.preview, bitmap);
	assert.deepEqual(input.collisionPaths, []);
	assert.equal(input.collision, undefined);
	const releaseSecond = t.mock.method(input.preview!, 'dispose');
	input.model.select(input.model.rows.findIndex(row => row.asset === removed));
	input.updatePreview();
	assert.equal(input.preview, undefined);
	assert.equal(input.showingImage, false);
	assert.equal(releaseSecond.mock.callCount(), 1);
	input.updatePreview();
	assert.equal(release.mock.callCount(), 1);
	assert.equal(releaseSecond.mock.callCount(), 1);
});
