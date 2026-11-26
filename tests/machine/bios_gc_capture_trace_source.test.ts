import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = '61e40427ed56ea18e7fad271ef3afa1735b9ba9e';
const port = 'machine/bios/kernel/gc_capture_trace.lua';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts'], ['C', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['H', 'machine/cpp/machine/cpu/gc_heap.h'],
	['O', 'machine/ts/machine/cpu/gc_object.ts'], ['P', 'machine/cpp/machine/cpu/gc_object.h'],
	['U', 'machine/ts/machine/cpu/upvalue.ts'], ['V', 'machine/cpp/machine/cpu/upvalue.h'], ['W', 'machine/cpp/machine/cpu/upvalue.cpp'],
	['L', 'machine/ts/machine/cpu/closure.ts'], ['B', 'machine/cpp/machine/cpu/closure.h'], ['D', 'machine/cpp/machine/cpu/closure.cpp'],
	['I', 'machine/ts/machine/cpu/thread_record.ts'], ['J', 'machine/cpp/machine/cpu/thread_record.h'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts'],
] as const;

test('Closure and Upvalue trace maps both native mirrors without claiming the caller admission', () => {
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
			const reference = sources.get(key);
			assert.ok(reference, `${port}:${index + 1}: unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= reference.lines.length, `${port}:${index + 1}: invalid origin ${entry}`);
				for (let n = first; n <= last; ++n) reference.covered.add(n);
			}
		}
	}
	const mapped = [
		['T', [[148, 152], [156, 158], [321, 327], [390, 394], [396, 407], [505, 516], [518, 518], [525, 525]]],
		['C', [[253, 257], [288, 290], [301, 307], [388, 392], [394, 406], [516, 526], [529, 529], [542, 542]]],
		['U', [[25, 27], [53, 61]]], ['W', [[15, 20], [28, 30], [56, 63]]],
		['L', [[50, 57]]], ['D', [[68, 76]]], ['B', [[85, 87]]],
	] as const;
	for (const [key, slices] of mapped) {
		const source = sources.get(key)!;
		for (const [first, last] of slices) {
			for (let n = first; n <= last; ++n) {
				const operation = source.lines[n - 1];
				if (/^\s*(?:$|\/\/|}$)/.test(operation)) continue;
				assert.ok(source.covered.has(n), `${key}:${n}: no BLua destination for ${operation.trim()}`);
			}
		}
	}
	// Mutating rejected queue heads or starting Table/Thread traversal is
	// still the caller's responsibility, not an equivalent Closure action.
	for (const [key, lines] of [['T', [385, 386, 387, 395, 408]], ['C', [384, 385, 393, 407]]] as const)
		for (const line of lines) assert.equal(sources.get(key)!.covered.has(line), false, `${key}:${line}: caller-owned`);
});
