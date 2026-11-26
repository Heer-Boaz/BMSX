import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_mark.lua';
const basis = '1a77f86de7ee9943612a729dc32f2534fda7b6a3';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '808b6c17bc8d73a98a1bafb990c998575f1d56625b36093d7d8fc4256cc9a38d'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '7c39341b20e2f3cd53d9361741d7d761121539263d9abaa37c398457073cad36'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', '39b47bcb30bdde8752f634bc767ad2ec0e98bca3af6a47cf4af572ce1b275ecf'],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
	['P', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['I', 'machine/ts/machine/cpu/thread_record.ts', '4d40495cd566545d52d5b1c4c1d6cfe615a61d13be3905fb645aa29203e9ae24'],
	['J', 'machine/cpp/machine/cpu/thread_record.h', 'f612d2139b3e6d7f5b26512ac24ee5fc85b641fee7000899c29323f7023ac5b5'],
	['S', 'machine/ts/machine/cpu/string_pool.ts', '7c4798b76c88b57e3d4ec2972f09a63497e3b236b59fd631da44587d8da23e2f'],
	['R', 'machine/cpp/machine/cpu/string_pool.cpp', '2a25235ff8086ddec22e581c276a048a7802bebd8df5eac37dfad6910725e3bf'],
	['Q', 'machine/cpp/machine/cpu/string_pool.h', '476970624d117e1a46d848903282e7a560cd676890f815d46cae35f0484c1b8f'],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1'],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5'],
	['D', 'machine/common/dlmalloc/dlmalloc.c', '8f2aab7de1a281c512357ab3dd835896498396680f3226dd96290d650ff1c4da'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('the BIOS GC mark map covers its pinned mutating paths and dispatch decisions', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		const source = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file}: review changed reference bytes`);
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').replaceAll('\r\n', '\n').split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${port}:${index + 1}: missing native origin for ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const native = sources.get(key);
			assert.ok(native, `${port}:${index + 1}: unknown ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= native.lines.length, `${port}:${index + 1}: invalid ${entry}`);
				for (let n = first; n <= last; ++n) native.covered.add(n);
			}
		}
	}
	const slices = [
		['T', [[93, 93], [172, 177], [182, 189], [306, 319], [327, 338]]],
		['C', [[77, 102], [259, 266], [272, 274], [280, 282], [297, 299]]],
		['H', [[92, 92], [120, 120], [146, 150], [160, 160]]],
		['S', [[34, 34], [430, 436], [446, 446], [448, 452]]],
		['R', [[419, 426], [439, 439], [441, 441]]],
		['D', [[679, 684]]],
	] as const;
	for (const [key, ranges] of slices) {
		const native = sources.get(key)!;
		for (const [first, last] of ranges) for (let n = first; n <= last; ++n) {
			const statement = native.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$)/.test(statement)) continue;
			assert.ok(native.covered.has(n), `${key}:${n}: no firmware mapping for ${statement.trim()}`);
		}
	}
});
