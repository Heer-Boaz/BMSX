import { GC_PACE_PAID } from '../helpers/native_heap/gc_heap';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { numberConstantValue } from '../../toolchain/ts/lua/number';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { LuaSyntaxKind, LuaTableFieldKind } from '../../toolchain/ts/lua/syntax/ast';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const basis = '61e40427ed56ea18e7fad271ef3afa1735b9ba9e';
const path = 'machine/bios/kernel/gc_pace.lua', decoder = 'machine/bios/kernel/gc_control.lua';
const source = readFileSync(path, 'utf8');
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts'], ['C', 'machine/cpp/machine/cpu/gc_heap.cpp'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h'], ['A', 'machine/ts/machine/cpu/heap_allocator.ts'],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp'], ['N', 'machine/ts/machine/common/numeric.ts'],
	['O', 'machine/cpp/machine/common/numeric.h'], ['M', 'machine/ts/spec/bmsx/memory_map.ts'],
] as const;

test('the typed pace window is contiguous after the published sweep link', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([path, decoder]));
	const control = workspace.updateFile(decoder, readFileSync(decoder, 'utf8'));
	const pace = workspace.updateFile(path, source);
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const returning = control.chunk.body.get(control.chunk.body.length - 1);
	assert.ok(returning.kind === LuaSyntaxKind.ReturnStatement);
	const exports = returning.expressions[0];
	assert.ok(exports.kind === LuaSyntaxKind.TableConstructorExpression);
	const internal = exports.fields.find(field => field.kind === LuaTableFieldKind.IdentifierKey && field.name === 'internal')?.value;
	assert.ok(internal?.kind === LuaSyntaxKind.TableConstructorExpression);
	const field = internal.fields.find(field => field.kind === LuaTableFieldKind.IdentifierKey && field.name === 'sweep_link_offset');
	assert.ok(field);
	const offset = types.constants.evaluate(control, field.value);
	assert.ok(offset?.kind === 'number');
	const base = numberConstantValue(offset.value) + 4;
	const span = pace.chunk.body.get(pace.chunk.body.length - 1).span;
	const state = types.resolve(path, { name: 'gc_pace_state', arrayLengths: [], span });
	assert.equal(state.size, 20);
	for (const [name, expected] of [['basis', -12], ['estimate', -8], ['runway', -4], ['paid', 0], ['pay_at', 4]] as const) {
		const field = state.struct!.fields.get(name);
		assert.ok(field, name);
		assert.equal(base + field.offset, GC_PACE_PAID + expected, name);
		assert.equal(field.size, 4, name);
	}
});

test('begin and update pace cover the frozen source paths without mutator or epoch work', () => {
	assert.ok(source.includes(`Source basis: ${basis}.`));
	const refs = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [name, file] of pins) {
		const lines = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).split('\n');
		refs.set(name, { lines, covered: new Set() });
	}
	const lines = source.split('\n');
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [i, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${path}:${i + 1}: missing source for ${line.trim()}`);
		for (const part of mark[1].trim().split(/\s+/)) {
			const [name, intervals] = part.split(':');
			const ref = refs.get(name);
			assert.ok(ref, `unknown source ${name}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= ref.lines.length, `${path}:${i + 1}: invalid origin ${part}`);
				for (let n = first; n <= last; ++n) ref.covered.add(n);
			}
		}
	}
	for (const [name, intervals] of [
		['T', [[51, 55], [854, 862], [864, 873]]], ['C', [[908, 917], [919, 929]]], ['H', [[51, 55]]],
		['A', [[49, 51]]], ['B', [[48, 50]]], ['N', [[12, 15]]], ['O', [[13, 16]]],
	] as const) {
		const ref = refs.get(name)!;
		for (const [first, last] of intervals) {
			for (let n = first; n <= last; ++n) {
				const line = ref.lines[n - 1];
				if (/^\s*(?:$|\/\/|}$)/.test(line)) continue;
				assert.ok(ref.covered.has(n), `${name}:${n} has no BLua destination: ${line.trim()}`);
			}
		}
	}
});
