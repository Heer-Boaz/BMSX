import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = '9b002adf22c0a496d45fac0bca5cab2030cda3b9';
const port = 'machine/bios/kernel/gc_thread_trace.lua';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts'], ['C', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['H', 'machine/cpp/machine/cpu/gc_heap.h'],
	['I', 'machine/ts/machine/cpu/thread_record.ts'], ['J', 'machine/cpp/machine/cpu/thread_record.h'],
	['F', 'machine/ts/machine/cpu/call_state.ts'], ['G', 'machine/cpp/machine/cpu/call_state.h'],
	['U', 'machine/ts/machine/cpu/upvalue.ts'], ['V', 'machine/cpp/machine/cpu/upvalue.h'],
	['S', 'machine/ts/machine/cpu/value_slots.ts'], ['N', 'machine/cpp/machine/cpu/value_slots.h'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts'], ['O', 'machine/ts/machine/cpu/gc_object.ts'], ['P', 'machine/cpp/machine/cpu/gc_object.h'],
	['Q', 'machine/ts/machine/cpu/cpu.ts'],
	['A', 'machine/ts/machine/common/numeric.ts'], ['B', 'machine/cpp/machine/common/numeric.h'],
] as const;

test('Thread trace maps both native stage machines and the payload-before-tag clear', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, path] of pins) {
		const lines = execFileSync('git', ['show', basis + ':' + path], { encoding: 'utf8' }).split('\n');
		sources.set(key, { lines, covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').split('\n');
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${port}:${index + 1}: missing origin for ${line.trim()}`);
		for (const entry of mark[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const source = sources.get(key);
			assert.ok(source, `${port}:${index + 1}: unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= source.lines.length, `${port}:${index + 1}: invalid origin ${entry}`);
				for (let n = first; n <= last; ++n) source.covered.add(n);
			}
		}
	}
	const spans = [
		['T', [[410, 504]]], ['C', [[410, 514]]],
		['I', [[118, 122], [125, 126], [128, 134], [143, 147], [150, 154]]],
		['J', [[37, 37], [41, 46], [59, 60], [63, 64]]],
		['S', [[75, 80], [83, 84]]], ['N', [[38, 44], [75, 83], [86, 87], [168, 175], [183, 187]]],
		['Q', [[5055, 5056]]], ['A', [[66, 67]]], ['B', [[69, 70]]],
	] as const;
	for (const [key, ranges] of spans) {
		const source = sources.get(key)!;
		for (const [first, last] of ranges) {
			for (let n = first; n <= last; ++n) {
				const operation = source.lines[n - 1];
				if (/^\s*(?:$|\/\/|[{}];?$)/.test(operation)) continue;
				assert.ok(source.covered.has(n), `${key}:${n}: no BLua destination for ${operation.trim()}`);
			}
		}
	}
	const thread = sources.get('I')!;
	for (const [line, unused] of [[123, 'frames'], [124, 'continuations'], [127, 'top']] as const) {
		assert.ok(thread.lines[line - 1].trimStart().startsWith(`target.${unused} =`));
		assert.equal(thread.covered.has(line), false, 'layout scratch not used by Thread trace');
	}
});
