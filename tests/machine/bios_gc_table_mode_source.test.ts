import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_table_mode.lua';
const basis = '9b002adf22c0a496d45fac0bca5cab2030cda3b9';
const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7'],
	['D', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932'],
	['E', 'machine/cpp/machine/cpu/table.cpp', '2b8976327da44c9c7fd5f6d5df7b01b6d2593387024fdb9e3cae19ac04403d3e'],
	['G', 'machine/ts/machine/cpu/gc_heap.ts', '5cded67b5e3eab37552b868c64b60a0438a4c47086080f89f96518a71a138d9f'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '98a3570d84b887c6273a04c326ebded7604db0dbc4574c6ed7853bf949570de5'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'ccd184f03de9310a1f0f7a08ebd5869a36bd2cfd797b40831e81decb20a1d9ff'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['S', 'machine/ts/spec/blua32/image_format.ts', '0b4ed00f7eb0424bb1f5d986714bb583ba90c406b9d999be7f983ac6d69cef27'],
	['I', 'machine/cpp/spec/blua32/image_format.h', 'aeecfe352449d8e467a0b72d78ce402145960807c9ec0483d70d2ebc6f5e30dd'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('the BIOS __mode map covers both pinned String hash probes and persisted cursor decisions', () => {
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
		'\tinternal = { advance_string_probe = advance_string_probe },',
		'\tprobe_table_mode = probe_table_mode,',
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
		['T', [[34, 34], [110, 112], [133, 133], [137, 137], [309, 347]]],
		['D', [[27, 27], [33, 37], [44, 44], [55, 55], [58, 58], [240, 240], [246, 249],
			[271, 274], [288, 290], [300, 306]]],
		['E', [[116, 126], [868, 881]]],
		['G', [[39, 42], [354, 375]]],
		['C', [[328, 352]]],
		['H', [[38, 41]]],
		['V', [[101, 102]]],
		['W', [[123, 124]]],
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
