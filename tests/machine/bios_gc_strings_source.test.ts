import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_strings.lua';
const basis = '0e7097869e82c2129fd4f5babfd4cecadba76d5d';
const pins: readonly [key: string, file: string, sha: string, span?: readonly [first: number, count: number]][] = [
	['T', 'machine/ts/machine/cpu/string_pool.ts', '4246f09d99c1972351f67c87de2fc69c405b06f3bd56b8fc48b18623566ad39e'],
	['C', 'machine/cpp/machine/cpu/string_pool.cpp', '2a25235ff8086ddec22e581c276a048a7802bebd8df5eac37dfad6910725e3bf'],
	['H', 'machine/cpp/machine/cpu/string_pool.h', '476970624d117e1a46d848903282e7a560cd676890f815d46cae35f0484c1b8f'],
	['S', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
	['I', 'machine/ts/spec/blua32/image_format.ts', '0b4ed00f7eb0424bb1f5d986714bb583ba90c406b9d999be7f983ac6d69cef27'],
	// Only the allocation helpers called by this subphase are pinned here.
	// Their original line coordinates remain valid when other owners grow.
	['L', 'machine/ts/machine/cpu/lua_heap.ts', '5db8b15b93c923a308414ce21b05b46af26a262e39aa548439547c616ca61a23', [281, 7]],
	['B', 'machine/cpp/machine/cpu/lua_heap.cpp', '0dc0d07e2b8b8ec2329b7e84d727aee83270dc51c7f6fe6f3e3cea9d256ee7c7', [288, 9]],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', 'f30434eb6c259dad2e204f646e91cc054bf3d4b4406aa039c6cec4676648136e', [61, 12]],
	['E', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'bb0937455000b3184befc209c3c0ba4132160436e5439ac6d1046e5ab9db9d52', [59, 12]],
];

test('the String collector source map pins both mirrors and covers the migrated operations', () => {
	const sources = new Map<string, { first: number; lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest, span] of pins) {
		const fileLines = execFileSync('git', ['show', basis + ':' + file], { encoding: 'utf8' }).replaceAll('\r\n', '\n').split('\n');
		const first = span ? span[0] : 1;
		const lines = span ? fileLines.slice(first - 1, first - 1 + span[1]) : fileLines;
		assert.equal(createHash('sha256').update(lines.join('\n')).digest('hex'), digest,
			`${file}: review the pinned mapping before updating this reference`);
		sources.set(key, { first, lines, covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').replaceAll('\r\n', '\n').split('\n');
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${port}:${index + 1}: missing origin for ${line.trim()}`);
		for (const entry of mark[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const ref = sources.get(key);
			assert.ok(ref, `${port}:${index + 1}: unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= ref.first && last >= first && last < ref.first + ref.lines.length,
					`${port}:${index + 1}: invalid interval ${entry}`);
				for (let line = first; line <= last; ++line) ref.covered.add(line);
			}
		}
	}
	const slices = [
		['T', [[267, 301], [303, 328], [430, 436], [445, 445], [454, 526]]],
		['C', [[262, 295], [297, 322], [419, 426], [438, 438], [443, 524]]],
	] as const;
	for (const [key, ranges] of slices) {
		const ref = sources.get(key)!;
		for (const [first, last] of ranges) {
			for (let line = first; line <= last; ++line) {
				const source = ref.lines[line - ref.first];
				if (/^\s*(?:$|\/\/|}$)/.test(source)) continue;
				assert.ok(ref.covered.has(line), `${key}:${line}: no BLua mapping for ${source.trim()}`);
			}
		}
	}
});
