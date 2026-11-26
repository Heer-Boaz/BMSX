import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_weak_table.lua';
const basis = '5c40682c88a6786933d7d651023d5d8b485655af';
const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7'],
	['D', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932'],
	['E', 'machine/cpp/machine/cpu/table.cpp', '2b8976327da44c9c7fd5f6d5df7b01b6d2593387024fdb9e3cae19ac04403d3e'],
	['G', 'machine/ts/machine/cpu/gc_heap.ts', '5cded67b5e3eab37552b868c64b60a0438a4c47086080f89f96518a71a138d9f'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '98a3570d84b887c6273a04c326ebded7604db0dbc4574c6ed7853bf949570de5'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'ccd184f03de9310a1f0f7a08ebd5869a36bd2cfd797b40831e81decb20a1d9ff'],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
	['P', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['I', 'machine/ts/machine/cpu/thread_record.ts', '4d40495cd566545d52d5b1c4c1d6cfe615a61d13be3905fb645aa29203e9ae24'],
	['J', 'machine/cpp/machine/cpu/thread_record.h', 'f612d2139b3e6d7f5b26512ac24ee5fc85b641fee7000899c29323f7023ac5b5'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('the BIOS weak Table map covers both pinned storage loops, death markers and alive gates', () => {
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
	assert.deepEqual(lines.slice(exports), [
		'return {',
		'\tinternal = { mark_hash_node_dead = mark_hash_node_dead, write_slot = write_slot },',
		'\tvalue_is_alive = value_is_alive,',
		'\tclear_weak_entries = clear_weak_entries,',
		'}',
		'',
	]);
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
		['T', [[34, 34], [95, 97], [99, 109], [132, 133], [136, 137], [174, 184], [645, 658], [1173, 1198]]],
		['D', [[44, 47], [55, 58], [166, 189], [219, 219], [240, 240], [248, 256], [262, 269], [300, 306], [331, 332]]],
		['E', [[663, 674]]],
		['G', [[100, 117], [148, 154], [159, 161], [166, 167], [171, 171], [173, 173], [178, 178], [737, 738]]],
		['C', [[253, 257], [268, 270], [276, 278], [284, 286], [355, 371], [789, 791]]],
		['H', [[105, 105], [120, 120], [146, 146], [207, 207]]],
	] as const;
	for (const [key, ranges] of slices) {
		const native = sources.get(key)!;
		for (const [first, last] of ranges) for (let n = first; n <= last; ++n) {
			const statement = native.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$|};$|template<)/.test(statement)) continue;
			assert.ok(native.covered.has(n), `${key}:${n}: no firmware mapping for ${statement.trim()}`);
		}
	}
});
