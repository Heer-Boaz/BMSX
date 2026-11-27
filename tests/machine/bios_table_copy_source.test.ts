import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = '8cf6e61b2b8207a31ae7be9c7acb095910ff2793';
const pins = [
	['C', 'machine/cpp/machine/cpu/table.cpp', 'a86cc7968f0dc250348f79e74d3fc8f1b4979fd51b48ff13176587f46bea26bc'],
	['T', 'machine/ts/machine/cpu/table.ts', '2efe7b0a10f355bb40683bb59cab15a58f0515ee7307e431e86af2fdd336c978'],
	['L', 'machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	['A', 'machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	['X', 'machine/cpp/machine/cpu/cpu.cpp', '2a49ea851208d695acebfd520a5af367383501786b8c671f1e49a00d52f661f1'],
	['Y', 'machine/ts/machine/cpu/cpu.ts', '4c9f0119ecbc434c7a0fb0fb30a65e0bb00d8f7639cb46626c23343058d55e55'],
] as const;

test('the ordinary Table copy pins both native routines and every backing/header effect', () => {
	const sources = new Map<string, { lines: string[]; mapped: Set<number> }>();
	for (const [label, file, digest] of pins) {
		const content = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(content).digest('hex'), digest, file);
		sources.set(label, { lines: content.split('\n'), mapped: new Set() });
	}
	const firmware = 'machine/bios/kernel/';
	const table = readFileSync(`${firmware}table_create.lua`, 'utf8');
	const ingress = readFileSync(`${firmware}bios_copy_table.lua`, 'utf8');
	assert.ok(table.includes(`-- Own-Table copy basis: ${basis}.`));
	assert.ok(ingress.includes(`-- Source basis: ${basis}.`));
	const record = readFileSync(`${firmware}allocate_record.lua`, 'utf8');
	const scope = readFileSync(`${firmware}gc_operand_roots.lua`, 'utf8');
	for (const [source, begin, end, labels] of [
		[table, 'local copy_capacities<const>', '\nreturn {', {}],
		[ingress, 'local layout<const>', '\nreturn {', { C: 'X', T: 'Y' }],
		[record, 'local copy<const>', '\n\tlocal roots_published', { B: 'C', J: 'T' }],
	] as const) {
		assert.ok(source.includes(begin) && source.includes(end));
		for (const line of source.slice(source.indexOf(begin), source.indexOf(end)).split('\n')) {
			if (/^\s*(?:$|--|end$)/.test(line)) continue;
			const marks = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
			assert.ok(marks, `missing source for ${line.trim()}`);
			for (const entry of marks[1].trim().split(/\s+/)) {
				const [label, intervals] = entry.split(':');
				const source = sources.get((labels as Record<string, string>)[label] ?? label);
				if (begin === 'local copy<const>' && label !== 'B' && label !== 'J') continue; // existing constructor/Closure basis
				assert.ok(source, entry);
				for (const interval of intervals.split(',')) {
					const [first, last = first] = interval.split('-').map(Number);
					assert.ok(first > 0 && last >= first && last <= source.lines.length, entry);
					for (let n = first; n <= last; ++n) source.mapped.add(n);
				}
			}
		}
	}
	assert.ok(scope.includes(`-- Table copy basis: ${basis}.`));
	assert.match(scope, /scope\.receiver = source/); // same explicit source root as native
	assert.match(ingress, /-- C:1228 T:4435;/); // old host charge intentionally becomes instruction retirement
	for (const [label, first, last] of [['C', 33, 55], ['T', 69, 91], ['X', 1224, 1229], ['Y', 4430, 4436]] as const) {
		const source = sources.get(label)!;
		for (let n = first; n <= last; ++n) {
			const line = source.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}];?$)/.test(line) || label === 'T' && n === 75) continue;
			if (label === 'X' && n === 1228 || label === 'Y' && n === 4435) continue;
			assert.ok(source.mapped.has(n), `${label}:${n} no BLua destination for ${line.trim()}`);
		}
	}
});
