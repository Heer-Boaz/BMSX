import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readLE32 } from '../../machine/ts/common/endian';
import {
	IO_GX_CHARACTER_CELL_ADDRESS,
	IO_GX_CHARACTER_CELL_DATA,
	IO_GX_CHARACTER_CONTROL,
	IO_GX_CHARACTER_GLYPH_ADDRESS,
	IO_GX_CHARACTER_GLYPH_DATA,
	IO_GX_CHARACTER_PALETTE_ADDRESS,
	IO_GX_CHARACTER_PALETTE_DATA,
} from '../../machine/ts/machine/bus/io';
import {
	GX_CHARACTER_PLANE_CELL_WORDS,
	GX_CHARACTER_PLANE_CONTROL_ENABLE,
	GX_CHARACTER_PLANE_GLYPH_WORDS,
	GX_CHARACTER_PLANE_PALETTE_WORDS,
	GX_CHARACTER_PLANE_WORD_BYTES,
	GxCharacterPlane,
} from '../../machine/ts/machine/devices/gx/character_plane';
import { Memory } from '../../machine/ts/machine/memory/memory';
import {
	GxCharacterPlaneSoftwarePipeline,
	renderGxCharacterPlaneSoftware,
} from '../../machine/ts/render/backend/software/gx_character_plane';
import {
	GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES,
	GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH,
	GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES,
	GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH,
	GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES,
	writeGxCharacterPlaneCellTexture,
	writeGxCharacterPlaneGlyphTexture,
	writeGxCharacterPlanePaletteTexture,
} from '../../machine/ts/render/gx/character_plane_resources';

function createCharacterPlane(): { memory: Memory; plane: GxCharacterPlane } {
	const memory = new Memory({
		systemRom: new Uint8Array(0),
		cartRom: new Uint8Array(0),
	});
	const plane = new GxCharacterPlane(memory);
	plane.reset();
	return { memory, plane };
}

test('GX character plane exposes raw indexed SRAM registerfiles', () => {
	const { memory, plane } = createCharacterPlane();
	const resetOutput = plane.readDeviceOutput();

	assert.equal(resetOutput.controlWord, 0);
	assert.equal(readLE32(resetOutput.paletteBytes, 0), 0);
	assert.equal(readLE32(resetOutput.glyphBytes, 0), 0);
	assert.equal(readLE32(resetOutput.cellBytes, 0), 0);

	memory.writeMappedU32LE(IO_GX_CHARACTER_CONTROL, (0x80000000 | GX_CHARACTER_PLANE_CONTROL_ENABLE) >>> 0);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_CONTROL), 0x80000001);

	const paletteRevisionBeforeWrite = plane.readDeviceOutput().paletteRevision;
	const glyphRevisionBeforePaletteWrite = plane.readDeviceOutput().glyphRevision;
	const cellRevisionBeforePaletteWrite = plane.readDeviceOutput().cellRevision;
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS, GX_CHARACTER_PLANE_PALETTE_WORDS - 1);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0x89abcdef);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0x01234567);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS), 1);
	assert.equal(readLE32(resetOutput.paletteBytes, (GX_CHARACTER_PLANE_PALETTE_WORDS - 1) * GX_CHARACTER_PLANE_WORD_BYTES), 0x89abcdef);
	assert.equal(readLE32(resetOutput.paletteBytes, 0), 0x01234567);
	assert.notEqual(plane.readDeviceOutput().paletteRevision, paletteRevisionBeforeWrite);
	assert.equal(plane.readDeviceOutput().glyphRevision, glyphRevisionBeforePaletteWrite);
	assert.equal(plane.readDeviceOutput().cellRevision, cellRevisionBeforePaletteWrite);

	const paletteRevisionBeforeGlyphWrite = plane.readDeviceOutput().paletteRevision;
	const glyphRevisionBeforeWrite = plane.readDeviceOutput().glyphRevision;
	const cellRevisionBeforeGlyphWrite = plane.readDeviceOutput().cellRevision;
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_ADDRESS, GX_CHARACTER_PLANE_GLYPH_WORDS - 1);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_DATA, 0xfedcba98);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_DATA, 0x76543210);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_GLYPH_ADDRESS), 1);
	assert.equal(readLE32(resetOutput.glyphBytes, (GX_CHARACTER_PLANE_GLYPH_WORDS - 1) * GX_CHARACTER_PLANE_WORD_BYTES), 0xfedcba98);
	assert.equal(readLE32(resetOutput.glyphBytes, 0), 0x76543210);
	assert.equal(plane.readDeviceOutput().paletteRevision, paletteRevisionBeforeGlyphWrite);
	assert.notEqual(plane.readDeviceOutput().glyphRevision, glyphRevisionBeforeWrite);
	assert.equal(plane.readDeviceOutput().cellRevision, cellRevisionBeforeGlyphWrite);

	const paletteRevisionBeforeCellWrite = plane.readDeviceOutput().paletteRevision;
	const glyphRevisionBeforeCellWrite = plane.readDeviceOutput().glyphRevision;
	const cellRevisionBeforeWrite = plane.readDeviceOutput().cellRevision;
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, GX_CHARACTER_PLANE_CELL_WORDS - 1);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0xdeadbeef);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0x13579bdf);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS), 1);
	assert.equal(readLE32(resetOutput.cellBytes, (GX_CHARACTER_PLANE_CELL_WORDS - 1) * GX_CHARACTER_PLANE_WORD_BYTES), 0xdeadbeef);
	assert.equal(readLE32(resetOutput.cellBytes, 0), 0x13579bdf);
	assert.equal(plane.readDeviceOutput().paletteRevision, paletteRevisionBeforeCellWrite);
	assert.equal(plane.readDeviceOutput().glyphRevision, glyphRevisionBeforeCellWrite);
	assert.notEqual(plane.readDeviceOutput().cellRevision, cellRevisionBeforeWrite);

	const output = plane.readDeviceOutput();
	assert.equal(output, resetOutput);
	const paletteRevisionBeforeReset = output.paletteRevision;
	const glyphRevisionBeforeReset = output.glyphRevision;
	const cellRevisionBeforeReset = output.cellRevision;
	plane.reset();
	assert.equal(plane.readDeviceOutput().controlWord, 0);
	assert.equal(readLE32(output.paletteBytes, 0), 0);
	assert.equal(readLE32(output.glyphBytes, 0), 0);
	assert.equal(readLE32(output.cellBytes, 0), 0);
	assert.notEqual(output.paletteRevision, paletteRevisionBeforeReset);
	assert.notEqual(output.glyphRevision, glyphRevisionBeforeReset);
	assert.notEqual(output.cellRevision, cellRevisionBeforeReset);
});

test('GX character plane data reads normalize and advance raw address latches', () => {
	const { memory } = createCharacterPlane();

	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS, 0xffffffff);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0xa1b2c3d4);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS, 0xffffffff);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA), 0xa1b2c3d4);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS), 0);

	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, 0xffffffff);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0x2468ace0);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, 0xffffffff);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_CELL_DATA), 0x2468ace0);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS), (0xffffffff % GX_CHARACTER_PLANE_CELL_WORDS) + 1);
});

test('GX character plane state restores SRAM and address latches in place', () => {
	const { memory, plane } = createCharacterPlane();

	memory.writeMappedU32LE(IO_GX_CHARACTER_CONTROL, 0xf0000001);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS, 3);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0x80007c00);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_ADDRESS, 65);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_DATA, 0x00f99f90);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, 321);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0xabcd1241);
	const state = plane.captureState();
	const output = plane.readDeviceOutput();
	const paletteBytes = output.paletteBytes;
	const glyphBytes = output.glyphBytes;
	const cellBytes = output.cellBytes;

	memory.writeMappedU32LE(IO_GX_CHARACTER_CONTROL, 0);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS, 3);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_ADDRESS, 65);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_DATA, 0);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, 321);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0);
	const changedRevision = plane.readDeviceOutput().cellRevision;

	plane.restoreState(state);
	const restored = plane.readDeviceOutput();
	assert.equal(restored.paletteBytes, paletteBytes);
	assert.equal(restored.glyphBytes, glyphBytes);
	assert.equal(restored.cellBytes, cellBytes);
	assert.equal(restored.controlWord, 0xf0000001);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS), 4);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_GLYPH_ADDRESS), 66);
	assert.equal(memory.readMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS), 322);
	assert.equal(readLE32(restored.paletteBytes, 3 * GX_CHARACTER_PLANE_WORD_BYTES), 0x80007c00);
	assert.equal(readLE32(restored.glyphBytes, 65 * GX_CHARACTER_PLANE_WORD_BYTES), 0x00f99f90);
	assert.equal(readLE32(restored.cellBytes, 321 * GX_CHARACTER_PLANE_WORD_BYTES), 0xabcd1241);
	assert.notEqual(restored.cellRevision, changedRevision);
});

test('GX character plane backend resources and software composition preserve transparency and clipping', () => {
	const { memory, plane } = createCharacterPlane();
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_ADDRESS, 1);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0x801f);
	memory.writeMappedU32LE(IO_GX_CHARACTER_PALETTE_DATA, 0xfc00);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_ADDRESS, 65);
	memory.writeMappedU32LE(IO_GX_CHARACTER_GLYPH_DATA, 1);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, 0);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0x2141);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_ADDRESS, 160);
	memory.writeMappedU32LE(IO_GX_CHARACTER_CELL_DATA, 0x2141);
	const output = plane.readDeviceOutput();

	const cellPixels = new Uint8Array(GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES);
	const glyphPixels = new Uint8Array(GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES);
	const palettePixels = new Uint8Array(GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES);
	writeGxCharacterPlaneCellTexture(output.cellBytes, cellPixels);
	writeGxCharacterPlaneGlyphTexture(output.glyphBytes, glyphPixels);
	writeGxCharacterPlanePaletteTexture(output.paletteBytes, palettePixels);
	assert.deepEqual(Array.from(cellPixels.subarray(0, 4)), [65, 1, 2, 255]);
	assert.deepEqual(Array.from(cellPixels.subarray(GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH * 4, GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH * 4 + 4)), [65, 1, 2, 255]);
	const glyphOffset = (24 * GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH + 4) * 4;
	assert.deepEqual(Array.from(glyphPixels.subarray(glyphOffset, glyphOffset + 8)), [255, 0, 0, 255, 0, 0, 0, 255]);
	assert.deepEqual(Array.from(palettePixels.subarray(4, 12)), [255, 0, 0, 255, 0, 0, 255, 255]);

	const target = new Uint8Array(5 * 7 * 4);
	for (let offset = 0; offset < target.byteLength; offset += 4) {
		target[offset] = 9;
		target[offset + 1] = 10;
		target[offset + 2] = 11;
		target[offset + 3] = 255;
	}
	renderGxCharacterPlaneSoftware(new GxCharacterPlaneSoftwarePipeline(), { width: 5, height: 7, output }, target);
	assert.deepEqual(Array.from(target.subarray(0, 8)), [255, 0, 0, 255, 0, 0, 255, 255]);
	assert.deepEqual(Array.from(target.subarray(16, 20)), [9, 10, 11, 255]);
	assert.deepEqual(Array.from(target.subarray(5 * 6 * 4, 5 * 6 * 4 + 4)), [255, 0, 0, 255]);
});
