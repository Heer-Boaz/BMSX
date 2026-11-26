import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_table_trace.lua';
const basis = 'a9b0bb5ff98c539822013063a3ef557809464f28';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '5cded67b5e3eab37552b868c64b60a0438a4c47086080f89f96518a71a138d9f'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '98a3570d84b887c6273a04c326ebded7604db0dbc4574c6ed7853bf949570de5'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'ccd184f03de9310a1f0f7a08ebd5869a36bd2cfd797b40831e81decb20a1d9ff'],
	['A', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7'],
	['D', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932'],
	['S', 'machine/ts/machine/cpu/string_pool.ts', '7c4798b76c88b57e3d4ec2972f09a63497e3b236b59fd631da44587d8da23e2f'],
	['R', 'machine/cpp/machine/cpu/string_pool.cpp', '2a25235ff8086ddec22e581c276a048a7802bebd8df5eac37dfad6910725e3bf'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
	['P', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('the BIOS Table trace map covers both pinned physical loops, mode choices, work and cursor stores', () => {
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
		'\ttrace_table_edges = trace_table_edges,',
		'\ttrace_table_entries = trace_table_entries,',
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
		['T', [[25, 25], [33, 34], [57, 58], [97, 99], [565, 586]]],
		['C', [[67, 67], [69, 71], [588, 616]]],
		['A', [[34, 34], [132, 133], [136, 137], [1142, 1142], [1155, 1171]]],
		['D', [[27, 27], [55, 58], [144, 144], [150, 164], [240, 240], [248, 249], [300, 306], [331, 332]]],
		['S', [[446, 446], [448, 451]]],
		['R', [[439, 439], [441, 441]]],
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
