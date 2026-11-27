import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const basis = '277bea571bdf8be4c42cc2fb66f92ba59fa81f63';
const path = 'machine/bios/kernel/heap_floor.lua';
const references = [
	['T', 'machine/ts/machine/cpu/cpu.ts', '7c4c38c62ec559bae02461c1bc758b0685bb818c41342de03bb1981c692f5dcc', [1866, 1867, 1868, 1879, 1889, 1891]],
	['C', 'machine/cpp/machine/cpu/cpu.cpp', '4f990ffd5a5d4a3a1c47c8945ed177065a3a5789dbc07740a0dc7ad68d0d30eb', [913, 919, 920, 941, 947, 949, 950]],
	['G', 'machine/ts/machine/cpu/gc_heap.ts', 'ab8032dfa68a85160d2cf0ed7d2bddd84f395e730d600e049e90938950983077', [906, 908, 909, 910, 911, 1038, 1039]],
	['H', 'machine/cpp/machine/cpu/gc_heap.cpp', '0badf98ed9e0706b03190d6531f201ac47276f0a858b25020a1177ac2e68f4c0', [698, 699, 701, 702, 981, 982, 983, 984, 1137, 1138]],
	['K', 'machine/cpp/machine/cpu/gc_heap.h', 'a32d716bc5881e4c3f506b13fab40c8cfbf69306a2f44ab891aaaaca5830aca3', [20]],
] as const;

test('firmware EXEC floor admission and synchronous retry map to both original implementations', () => {
	const text = readFileSync(path, 'utf8');
	parseLuaChunk(text, path);
	assert.ok(text.includes(`-- Source basis: ${basis}.`));
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [label, file, digest] of references) {
		const raw = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(raw).digest('hex'), digest);
		sources.set(label, { lines: raw.split('\n'), covered: new Set() });
	}
	for (const [index, line] of text.split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|end$|return \{ reserve_floor =)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${path}:${index + 1} missing source mapping`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [label, intervals] = entry.split(':');
			const source = sources.get(label)!;
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= source.lines.length, entry);
				for (let n = first; n <= last; ++n) source.covered.add(n);
			}
		}
	}
	for (const [label, , , required] of references) for (const line of required)
		assert.ok(sources.get(label)!.covered.has(line), `${label}:${line} is not covered`);
});
