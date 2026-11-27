import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = 'e3774a03a44e94be4d9d8be73c7ce2de80a336c2';
const port = 'machine/bios/kernel/string_slice.lua';
const admission = 'machine/bios/kernel/allocate_string_slice.lua';
const numberBytes = 'machine/bios/kernel/number_bytes.lua';
const concatBasis = 'aca57683b472c8ee0ea2df3252d06f8fb380b062';
const pins = [
	['T', 'machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
	['C', 'machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
	['H', 'machine/ts/common/hash.ts', '7fa5b55b615d1d4297f6e4bdc84620995ed552f2ea7a6562b4bd353e9e989486'],
	['F', 'machine/cpp/common/hash_fnv.h', 'b706611572fe2850b4d1ef35230e2e4704efe87a5519e752e94e11d3101e3482'],
	['I', 'machine/ts/spec/blua32/image_format.ts', '222a5c56b6dc8fd7854be92494c33e487590edeab5bbbe0caf69b3ad5c5b8a18'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', 'fc9c0c0e9f6db81f27a6725bf4ef5d7062fb9b4114df95e26afeb12c76ea4432'],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5'],
	['L', 'machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	['N', 'machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	['G', 'machine/ts/machine/cpu/gc_heap.ts', 'f677c8ce0a75cf0a121535013677788e696a6c02eb8a5248cbc2422f7f1c65dd'],
	['Q', 'machine/cpp/machine/cpu/gc_heap.cpp', '5642ff30f0f11c4d573e539045e1a37fa718f246ac69f796b930d01b7eb6165c'],
	['X', 'machine/ts/machine/cpu/cpu.ts', '1652b6770aa7bc73c299b035d8e7d0663c3ea019827eaed3f465132ee5b99b56'],
	['Y', 'machine/cpp/machine/cpu/cpu.cpp', 'a1a8063a69dca585fe4a44d1ae3c673341854b823c1b22b79739abdbdfd74f03'],
	['Z', 'machine/cpp/machine/cpu/cpu_heap_service.inl', 'c3615be76e18cf72f955823f9393d005ee7f89d1313d2ab3dbf38359edaf89e1'],
] as const;

const concatPins = [
	['D', 'machine/cpp/common/number_format.h', 'ce4fd930c1fd1598d52a6a4b81bb0da904eea7e75141a5177c1373fb3703b8d3'],
	['E', 'machine/ts/common/number_format.ts', '92de419596be0ea024cb89d3ba5942873c8d68e74a44534d29a97ac175d7d7e3'],
	['P', 'machine/ts/machine/cpu/cpu.ts', '18e8fec35ff682caf72fc6b923c44208698069c860af020be66d58cfa1420a1c'],
	['V', 'machine/ts/machine/cpu/value.ts', 'a959ca93201df0aa7afc0188eef22b026bbf6704156f828f02bf619ef1b5af21'],
	['W', 'machine/cpp/machine/cpu/cpu_concat.cpp', '77432fef63b805c667399d5adf82b6fc7c3f0c1d64ba37740fe9f591556a40a8'],
] as const;

// The owned-buffer variants are separate. Memory stalls retain BMSX's
// existing allocation/sweep/recovery owners; only accounting cycles become
// instruction time. The test consumes external ROM status, not a CPU port.
const charBasis = '894c524ca1e51e7864aebf3c5350a46b3d7d6703';
const charBytes = 'machine/bios/kernel/string_char_bytes.lua';
const charPins = [
	['J', 'machine/cpp/machine/cpu/cpu.cpp', '575c11fe7d301a09afb2380b7572913d30520ad0575b40246091e853c314c6fa'],
	['K', 'machine/ts/machine/cpu/cpu.ts', '69e58fab2e249c2aed8664423ffc5b255cd26fcf46242870bd4a3585b0828d58'],
] as const;

const operations = [
	['T', [[52, 56], [142, 157], [161, 176], [179, 202], [205, 241], [351, 369], [370, 428]]],
	['C', [[72, 81], [84, 101], [156, 174], [176, 187], [190, 244], [347, 380], [382, 415]]],
	['L', [[160, 167]]],
	['N', [[168, 170], [173, 179]]],
	['D', [[15, 17], [18, 89], [91, 93], [97, 125]]],
	['E', [[6, 74], [75, 98]]],
	['J', [[1729, 1739]]],
	['K', [[5072, 5080]]],
	['V', [[132, 140]]],
	['W', [[16, 20], [38, 42], [48, 48], [54, 55], [103, 103], [109, 109], [136, 136]]],
] as const;

test('borrowed String leaves pin both owners and map each migrated source operation in both directions', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [commit, key, file, digest] of [
		...pins.map(entry => [basis, ...entry] as const),
		...concatPins.map(entry => [concatBasis, ...entry] as const),
		...charPins.map(entry => [charBasis, ...entry] as const),
	]) {
		const source = execFileSync('git', ['show', commit + ':' + file], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, file);
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}

	for (const file of [port, admission, numberBytes, charBytes]) {
		const text = readFileSync(file, 'utf8');
		assert.doesNotMatch(text, /layout\.(?:rom_extent_address|call_fault_address)/);
		const lines = text.split('\n');
		const end = lines.indexOf('return {');
		assert.ok(end > 0);
		for (const [index, line] of lines.slice(0, end).entries()) {
			if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
			const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
			assert.ok(mark, `${file}:${index + 1}: missing origin for ${line.trim()}`);
			for (const entry of mark[1].trim().split(/\s+/)) {
				const [key, intervals] = entry.split(':');
				const ref = sources.get(key)!;
				assert.ok(ref, `${file}:${index + 1}: unknown source ${key}`);
				for (const interval of intervals.split(',')) {
					const [first, last = first] = interval.split('-').map(Number);
					assert.ok(first > 0 && last >= first && last < ref.lines.length, entry);
					for (let number = first; number <= last; ++number) ref.covered.add(number);
				}
			}
		}
	}
	for (const [key, ranges] of operations) {
		const ref = sources.get(key)!;
		for (const [first, last] of ranges) {
			for (let line = first; line <= last; ++line) {
				const original = ref.lines[line - 1];
				if (/^\s*(?:$|\/\/|}\s*$)/.test(original)) continue;
				assert.ok(ref.covered.has(line), `${key}:${line} has no BLua destination: ${original.trim()}`);
			}
		}
	}
});
