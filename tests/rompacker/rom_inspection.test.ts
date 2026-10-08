import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CartRomHeader } from '../../machine/ts/rompack/format';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { BLUA32_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_image';
import { inspectRom, romAssetByteLength, romAssetIntersectsRange, romAssetRanges } from '../../toolchain/ts/rompack/inspection';

const header: CartRomHeader = {
	headerSize: 72,
	manifestOffset: 144, manifestLength: 12,
	tocOffset: 200, tocLength: 20,
	metadataOffset: 112, metadataLength: 32,
	dataOffset: 72, dataLength: 128,
	blua32ImageOffset: 160, blua32ImageByteCount: 32,
	blua32StartupFunctionAddress: 0,
	blua32IrqFunctionAddress: 0,
	blua32ExceptionFunctionAddress: 0,
	blua32StaticLayoutTokenLo: 0,
	blua32StaticLayoutTokenHi: 0,
	blua32DiagnosticDirectoryOffset: 0,
};

const model: RomAsset = {
	resid: 'model', type: 'model',
	start: 72, end: 80,
	model_texture_start: 80, model_texture_end: 96,
	collision_bin_start: 96, collision_bin_end: 108,
	metabuffer_start: 128, metabuffer_end: 144,
};

const code: RomAsset = { resid: BLUA32_IMAGE_ID, type: 'code', start: 160, end: 192 };

test('ROM physical sections partition bytes without counting nested metadata, executable aliases or the data envelope twice', () => {
	const rom = new Uint8Array(224);
	rom[195] = 0xa5; // A gap can contain retained bytes; it is not necessarily zero padding.
	const assets = [model, code];
	const report = inspectRom(rom, header, assets);
	assert.equal(report.byteLength, rom.length);
	assert.equal(report.sections.reduce((sum, section) => sum + section.end - section.start, 0), rom.length);
	let end = 0;
	for (const section of report.sections) {
		assert.equal(section.start, end);
		end = section.end;
	}
	assert.equal(end, rom.length);
	assert.equal(report.sections.filter(section => section.kind === 'blua32').length, 1);
	assert.equal(report.sections.filter(section => section.kind === 'metadata').length, 1);
	assert.equal(report.sections.filter(section => section.kind === 'manifest').length, 1);
	assert.equal(report.sections.filter(section => section.asset === model).length, 3);
	assert.deepEqual(report.sections.filter(section => section.kind === 'unreferenced').map(({ start, end }) => [start, end]), [
		[108, 112], [156, 160], [192, 200], [220, 224],
	]);
	assert.deepEqual(report.assetTypes, [
		{ type: 'model', count: 1, byteLength: 52 },
		{ type: 'code', count: 1, byteLength: 32 },
	]);
	assert.strictEqual(assets[0], model);
	assert.equal(model.buffer, undefined);
});

test('asset inspection includes metadata, model texture and collision buffers with half-open intersections', () => {
	assert.equal(romAssetByteLength(model), 52);
	assert.deepEqual(romAssetRanges(model), [
		{ kind: 'data', start: 72, end: 80 },
		{ kind: 'metadata', start: 128, end: 144 },
		{ kind: 'model-texture', start: 80, end: 96 },
		{ kind: 'collision', start: 96, end: 108 },
	]);
	for (const range of romAssetRanges(model)) {
		assert.equal(romAssetIntersectsRange(model, range.start, range.end), true);
	}
	assert.equal(romAssetIntersectsRange(model, 108, 128), false);
	assert.equal(romAssetIntersectsRange(model, 144, 160), false);
	assert.equal(romAssetByteLength({ resid: 'deleted', type: 'data', op: 'delete' }), 0);
});

test('data-only ROMs have no inferred executable and can contain metadata-only assets', () => {
	const dataHeader = { ...header, blua32ImageOffset: 0, blua32ImageByteCount: 0 };
	const asset: RomAsset = { resid: 'sprite', type: 'image', metabuffer_start: 128, metabuffer_end: 144 };
	const report = inspectRom(new Uint8Array(220), dataHeader, [asset]);
	assert.equal(report.sections.some(section => section.kind === 'blua32'), false);
	assert.deepEqual(report.assetTypes, [{ type: 'image', count: 1, byteLength: 16 }]);
	assert.equal(report.sections.reduce((sum, section) => sum + section.end - section.start, 0), 220);
});
