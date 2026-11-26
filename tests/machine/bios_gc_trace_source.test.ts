import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = '6a580740492a6ebdaca200fc90e243ebbcdcd230', port = 'machine/bios/kernel/gc_trace.lua';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts'], ['C', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['H', 'machine/cpp/machine/cpu/gc_heap.h'],
	['O', 'machine/ts/machine/cpu/gc_object.ts'], ['P', 'machine/cpp/machine/cpu/gc_object.h'],
	['U', 'machine/ts/machine/cpu/upvalue.ts'], ['V', 'machine/cpp/machine/cpu/upvalue.h'], ['W', 'machine/cpp/machine/cpu/upvalue.cpp'],
	['I', 'machine/ts/machine/cpu/thread_record.ts'], ['J', 'machine/cpp/machine/cpu/thread_record.h'],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts'], ['B', 'machine/cpp/machine/cpu/heap_allocator.cpp'],
	['D', 'machine/common/dlmalloc/dlmalloc.c'], ['E', 'machine/common/dlmalloc/dlmalloc.h'],
	['S', 'machine/ts/machine/cpu/string_pool.ts'], ['R', 'machine/cpp/machine/cpu/string_pool.cpp'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts'],
] as const;

test('the BIOS trace-quantum map covers both native admission, pop, dispatch and resume loops', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, path] of pins) {
		const source = execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${port}:${index + 1}: missing native origin for ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const native = sources.get(key);
			assert.ok(native, `${port}:${index + 1}: unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= native.lines.length, `${port}:${index + 1}: invalid range ${entry}`);
				for (let n = first; n <= last; ++n) native.covered.add(n);
			}
		}
	}
	const slices = [
		['T', [[377, 409], [517, 537]]], ['C', [[374, 408], [528, 556]]],
		['S', [[447, 451]]], ['R', [[440, 440]]], ['D', [[680, 683]]],
	] as const;
	for (const [key, ranges] of slices) {
		const native = sources.get(key)!;
		for (const [first, last] of ranges) {
			for (let n = first; n <= last; ++n) {
				if (/^\s*(?:$|\/\/|[{}];?$)/.test(native.lines[n - 1])) continue;
				assert.ok(native.covered.has(n), `${key}:${n}: no BLua destination for ${native.lines[n - 1].trim()}`);
			}
		}
	}
});
