import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = '0e7097869e82c2129fd4f5babfd4cecadba76d5d';
const port = 'machine/bios/kernel/dlmalloc_record.lua';
const pins = [
	['T', 'machine/ts/machine/cpu/lua_heap.ts', [[92, 113], [265, 279]]],
	['C', 'machine/cpp/machine/cpu/lua_heap.cpp', [[110, 131], [272, 286]]],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', [[56, 59], [61, 61]]],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', [[54, 57], [59, 59]]],
	['O', 'machine/ts/machine/cpu/gc_object.ts', [[5, 6], [9, 9]]],
	['P', 'machine/cpp/machine/cpu/gc_object.h', [[8, 9], [13, 13]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', [[6, 6]]],
	['N', 'machine/cpp/spec/bmsx/memory_map.h', [[12, 12]]],
] as const;

test('the BIOS record allocator traces reservation, release, accounting and failure paths', () => {
	const coverage = new Map<string, Map<number, string>>();
	for (const [key, path, ranges] of pins) {
		const lines = execFileSync('git', ['show', basis + ':' + path], { encoding: 'utf8' }).split('\n');
		const operations = new Map<number, string>();
		for (const [first, last] of ranges) {
			for (let line = first; line <= last; ++line) {
				const source = lines[line - 1].trim();
				if (source !== '' && source !== '}' && !source.startsWith('//')) operations.set(line, source);
			}
		}
		coverage.set(key, operations);
	}
	const lines = readFileSync(port, 'utf8').split('\n');
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${port}:${index + 1}: missing origin for ${line.trim()}`);
		for (const entry of mark[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const pin = pins.find(([id]) => id === key);
			assert.ok(pin, `unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first <= last && pin[2].some(([a, b]) => first >= a && last <= b), `invalid source operation ${entry}`);
				for (let n = first; n <= last; ++n) coverage.get(key)!.delete(n);
			}
		}
	}
	for (const [key, uncovered] of coverage) assert.deepEqual([...uncovered], [], `${key}: unmapped native operations`);
});
