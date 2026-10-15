import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { decodeRomToc, type RomTocEntry } from '../../machine/ts/rompack/toc';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { loadBlua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_symbols';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { linkRawTestBlua32Pair } from '../helpers/blua32';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';

const text = new Uint8Array(INSTRUCTION_BYTES);
writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
const source = { text, functions: [{ firstWord: 0, wordCount: 1 }], functionIds: ['entry'] };
const pair = linkRawTestBlua32Pair(source, source);

for (const [domain, bytes, base] of [
	['system', pair.systemRomBytes, SYSTEM_ROM_BASE],
	['cart', pair.cartRomBytes, CART_ROM_BASE],
] as const) {
	const rom = { bytes, header: parseCartHeader(bytes) };
	const toc = decodeRomToc(bytes.subarray(rom.header.tocOffset, rom.header.tocOffset + rom.header.tocLength));

	test(`${domain} tooling image reuses predecoded physical entries without changing layout or symbols`, async () => {
		const expected = loadBlua32ToolingImage(rom, base);
		assert.notEqual(expected, null);
		assert.notEqual(expected.symbols, null);
		assert.deepEqual(expected.symbols.metadata.functionIds, ['entry']);
		assert.strictEqual(expected.layout.textBytes.buffer, bytes.buffer);
		assert.deepEqual(loadBlua32ToolingImage(rom, base, toc.entries), expected);
		assert.deepEqual(loadBlua32ToolingImage(rom, base, undefined), expected);
		const loaded = await loadRomAssetList(bytes, domain);
		const entries: readonly RomTocEntry[] = loaded.entries;
		assert.deepEqual(loadBlua32ToolingImage(rom, base, entries), expected);
	});

	test(`${domain} tooling image treats supplied empty and symbol-free entry spans as authoritative`, () => {
		const expected = loadBlua32ToolingImage(rom, base);
		for (const entries of [[], toc.entries.filter(entry => entry.resid !== BLUA32_SYMBOLS_IMAGE_ID)]) {
			const actual = loadBlua32ToolingImage(rom, base, entries);
			assert.notEqual(actual, null);
			assert.equal(actual.symbols, null);
			assert.deepEqual(actual.layout, expected.layout);
		}
	});

	test(`${domain} symbol-free physical directory still loads the executable`, () => {
		const entries = toc.entries.filter(entry => entry.resid !== BLUA32_SYMBOLS_IMAGE_ID);
		const directory = encodeRomToc({ entries });
		const stripped = new Uint8Array(rom.header.tocOffset + directory.length);
		stripped.set(bytes.subarray(0, rom.header.tocOffset));
		stripped.set(directory, rom.header.tocOffset);
		writeCartRomHeader(stripped, { ...rom.header, tocLength: directory.length });
		const image = { bytes: stripped, header: parseCartHeader(stripped) };
		const actual = loadBlua32ToolingImage(image, base);
		assert.notEqual(actual, null);
		assert.equal(actual.symbols, null);
		assert.deepEqual(loadBlua32ToolingImage(image, base, entries), actual);
		assert.deepEqual(actual.layout.textBytes, text);
	});
}

test('ROMs without an executable do not load tooling images with omitted or supplied entries', () => {
	const bytes = createTestRuntimeRomPayload();
	const rom = { bytes, header: parseCartHeader(bytes) };
	for (const base of [SYSTEM_ROM_BASE, CART_ROM_BASE]) {
		assert.equal(loadBlua32ToolingImage(rom, base), null);
		assert.equal(loadBlua32ToolingImage(rom, base, []), null);
	}
});
