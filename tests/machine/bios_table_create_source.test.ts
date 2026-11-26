import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const basis = '9b002adf22c0a496d45fac0bca5cab2030cda3b9';
const path = 'machine/bios/kernel/table_create.lua';
const source = readFileSync(path, 'utf8');
const pins = [
	['T', 'machine/ts/machine/cpu/table.ts'], ['C', 'machine/cpp/machine/cpu/table.cpp'], ['H', 'machine/cpp/machine/cpu/table.h'],
	['N', 'machine/ts/machine/cpu/cpu.ts'], ['P', 'machine/cpp/machine/cpu/cpu_table.cpp'],
	['U', 'machine/ts/machine/cpu/gc_heap.ts'], ['V', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['W', 'machine/cpp/machine/cpu/gc_heap.h'],
	['J', 'machine/ts/machine/cpu/value.ts'], ['K', 'machine/cpp/machine/cpu/value.h'], ['M', 'machine/ts/spec/bmsx/memory_map.ts'],
] as const;

test('the firmware Table header and both reservation backing offsets match their record owner', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([path]));
	const file = workspace.updateFile(path, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const header = types.resolve(path, { name: 'table_creation_header', arrayLengths: [], span });
	assert.equal(header.size, TableRecords.HEADER_BYTES);
	for (const [name, offset] of [
		['kind', TableHeader.Kind], ['gray', TableHeader.Gray], ['metatable', TableHeader.Metatable], ['hash_storage', TableHeader.HashStorage],
		['array_capacity', TableHeader.Array], ['hash_capacity', TableHeader.Hash], ['length', TableHeader.Length],
		['free', TableHeader.Free], ['array_storage', TableHeader.ArrayStorage],
	] as const) {
		const field = header.struct!.fields.get(name);
		assert.ok(field, name);
		assert.equal(field.offset, offset, name);
		assert.equal(field.size, 4, name);
	}
});

test('the construction source map covers mirrored reservation, initialization and inventory without the host root', () => {
	assert.ok(source.includes(`Source basis: ${basis}.`));
	const sources = new Map<string, { lines: string[]; mapped: Set<number> }>();
	for (const [name, file] of pins) {
		const lines = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).split('\n');
		sources.set(name, { lines, mapped: new Set() });
	}
	const lines = source.split('\n');
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${path}:${index + 1}: missing origin for ${line.trim()}`);
		for (const part of mark[1].trim().split(/\s+/)) {
			const [name, intervals] = part.split(':');
			const source = sources.get(name);
			assert.ok(source, `unknown source ${name}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= source.lines.length, `${path}:${index + 1}: invalid source ${part}`);
				for (let n = first; n <= last; ++n) source.mapped.add(n);
			}
		}
	}
	for (const [name, slices] of [
		['T', [[58, 67], [136, 137], [144, 164]]], ['C', [[22, 31], [483, 506]]],
		['N', [[463, 469], [472, 474]]], ['P', [[85, 97]]], ['U', [[133, 141]]], ['V', [[235, 244]]],
	] as const) {
		const source = sources.get(name)!;
		for (const [first, last] of slices) {
			for (let n = first; n <= last; ++n) {
				const line = source.lines[n - 1];
				if (/^\s*(?:$|\/\/|[{}])/.test(line)) continue;
				assert.ok(source.mapped.has(n), `${name}:${n} no BLua destination for ${line.trim()}`);
			}
		}
	}
	for (const [name, line, host] of [['N', 475, 'localRoots'], ['P', 98, 'trackLocalRoot']] as const) {
		const source = sources.get(name)!;
		assert.match(source.lines[line - 1], new RegExp(host));
		assert.equal(source.mapped.has(line), false, 'host activation still owns local roots');
	}
});
