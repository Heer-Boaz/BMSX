import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { hashAssetId } from '../../machine/ts/rompack/tokens';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';

test('physical directory completion retains records and matches encoded token pairs and program flags', () => {
	const completeToken = hashAssetId('complete-pair');
	const entries: RomAsset[] = [
		{ resid: 'neither', type: 'bin' },
		{ resid: 'low-only', type: 'code', id_token_lo: 123 },
		{ resid: 'high-only', type: 'lua', id_token_hi: 456, program_module: true },
		{ resid: 'complete-pair', type: 'bin', id_token_lo: completeToken.lo, id_token_hi: completeToken.hi, program_module: false },
	];
	const directory = entries;
	const records = [...entries];
	// Compare the existing serializer's authored-input semantics before completion.
	const originalBytes = encodeRomToc({ entries });
	const encoded = decodeRomToc(originalBytes);
	finalizePackedRomAssets(entries);
	assert.equal(entries, directory);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		assert.equal(entry, records[index], 'completion never copies a physical directory record');
		const physical = encoded.entries.find(candidate => candidate.resid === entry.resid)!;
		assert.equal(entry.id_token_lo, physical.id_token_lo);
		assert.equal(entry.id_token_hi, physical.id_token_hi);
		assert.equal(entry.program_module, physical.program_module);
	}
	for (let index = 0; index < 3; index += 1) {
		const token = hashAssetId(entries[index].resid);
		assert.equal(entries[index].id_token_lo, token.lo, 'an absent or partial authored pair is replaced as one token');
		assert.equal(entries[index].id_token_hi, token.hi);
	}
	assert.deepEqual([entries[3].id_token_lo, entries[3].id_token_hi], [completeToken.lo, completeToken.hi]);
	assert.equal(entries[2].program_module, true);
	assert.deepEqual(encodeRomToc({ entries }), originalBytes, 'completion preserves emitted physical bytes');
});

test('physical completion preserves complete raw token pairs without replacing representable zero words', () => {
	const entries: RomAsset[] = [
		{ resid: 'zero-pair', type: 'bin', id_token_lo: 0, id_token_hi: 0 },
		{ resid: 'custom-pair', type: 'code', id_token_lo: 0x12345678, id_token_hi: 0x9abcdef0 },
	];
	const originalBytes = encodeRomToc({ entries });
	finalizePackedRomAssets(entries);
	assert.deepEqual([entries[0].id_token_lo, entries[0].id_token_hi], [0, 0]);
	assert.deepEqual([entries[1].id_token_lo, entries[1].id_token_hi], [0x12345678, 0x9abcdef0]);
	assert.deepEqual(encodeRomToc({ entries }), originalBytes);
	finalizePackedRomAssets(entries);
	assert.deepEqual(encodeRomToc({ entries }), originalBytes, 'repeated completion does not replace an existing pair with a recomputed id hash');
});
