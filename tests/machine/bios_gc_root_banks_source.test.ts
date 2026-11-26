import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const basis = '6a580740492a6ebdaca200fc90e243ebbcdcd230';
const path = 'machine/bios/kernel/gc_root_banks.lua';
const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '5cded67b5e3eab37552b868c64b60a0438a4c47086080f89f96518a71a138d9f', [[43, 43], [58, 59], [69, 69], [588, 609]]],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '98a3570d84b887c6273a04c326ebded7604db0dbc4574c6ed7853bf949570de5', [[71, 72], [619, 642]]],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'ccd184f03de9310a1f0f7a08ebd5869a36bd2cfd797b40831e81decb20a1d9ff', [[20, 20], [42, 42]]],
	['U', 'machine/ts/machine/cpu/cpu.ts', '6ea5e0f4b7751b5a7dd2f4aea4aaada85cb56e322b7965bcbfecdcef416b9a36', [[5073, 5109]]],
	['P', 'machine/cpp/machine/cpu/cpu.cpp', '988eb3ffa01c93a3a05a06d5af03c2c86e06419f78dfaf4bb89d817ebdf3088b', [[3143, 3181]]],
	['G', 'machine/ts/machine/cpu/global_bank.ts', '904c7588e4ab57585c8d2a63a3242e6c531ec65ee66ca3f263e6536f931a0b53', [[21, 22], [31, 31]]],
	['B', 'machine/cpp/machine/cpu/global_bank.h', 'f1a02d7a99d9e4423039213ea342766ca02486e6021a91ef8eb8d7a0c10b95b8', [[23, 24], [34, 34]]],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641', [[9, 10]]],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e', [[21, 22]]],
	['O', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 6]]],
	['Q', 'machine/ts/machine/cpu/thread_record.ts', '4d40495cd566545d52d5b1c4c1d6cfe615a61d13be3905fb645aa29203e9ae24', [[33, 33]]],
	['R', 'machine/cpp/machine/cpu/thread_record.h', 'f612d2139b3e6d7f5b26512ac24ee5fc85b641fee7000899c29323f7023ac5b5', [[18, 18]]],
] as const;

test('root bank and Thread root descriptors bind the exact raw publication layout', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([path]));
	const file = workspace.updateFile(path, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	for (const [name, size, fields] of [
		['root_bank', 16, [['count', 0, 4], ['payloads', 4, 4], ['tags', 8, 4], ['names', 12, 4]]],
		['root_descriptors', 128, [['root', 0, 4], ['active', 4, 4], ['completion_thread', 8, 4], ['halted', 12, 4], ['banks', 16, 112]]],
	] as const) {
		const type = types.resolve(path, { name, arrayLengths: [], span });
		assert.equal(type.size, size, name);
		for (const [name, offset, size] of fields) {
			const field = type.struct!.fields.get(name);
			assert.ok(field, name);
			assert.equal(field.offset, offset, name);
			assert.equal(field.size, size, name);
		}
	}
});

test('the root bank firmware maps each mirrored scheduling, slot, and Thread order operation', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		const source = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file}: review changed reference bytes`);
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}
	const lines = source.split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${path}:${index + 1}: missing native origin for ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const native = sources.get(key);
			assert.ok(native, `${path}:${index + 1}: unknown ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= native.lines.length, `${path}:${index + 1}: invalid ${entry}`);
				for (let n = first; n <= last; ++n) native.covered.add(n);
			}
		}
	}
	for (const [key, , , slices] of pins) {
		const native = sources.get(key)!;
		for (const [first, last] of slices) for (let n = first; n <= last; ++n) {
			const statement = native.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$)/.test(statement)) continue;
			assert.ok(native.covered.has(n), `${key}:${n}: no firmware mapping for ${statement.trim()}`);
		}
	}
});
