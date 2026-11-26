import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HeapServiceObjectSweepAction as Action, HeapServiceObjectSweepField as Sweep } from '../../machine/ts/spec/bmsx/heap_service';
import { numberConstantValue } from '../../toolchain/ts/lua/number';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { LuaSyntaxKind, LuaTableFieldKind } from '../../toolchain/ts/lua/syntax/ast';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const basis = '70791ac4b03d36b191348c5810ca2cf3af2dc6c2';
const port = 'machine/bios/kernel/gc_objects.lua';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts'], ['C', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['H', 'machine/cpp/machine/cpu/gc_heap.h'],
	['A', 'machine/ts/machine/cpu/table.ts'], ['B', 'machine/cpp/machine/cpu/table.cpp'], ['D', 'machine/cpp/machine/cpu/table.h'],
	['O', 'machine/ts/machine/cpu/gc_object.ts'], ['P', 'machine/cpp/machine/cpu/gc_object.h'],
	['V', 'machine/ts/machine/cpu/value.ts'], ['W', 'machine/cpp/machine/cpu/value.h'],
	['I', 'machine/ts/machine/cpu/thread_record.ts'], ['J', 'machine/cpp/machine/cpu/thread_record.h'],
	['U', 'machine/ts/machine/cpu/upvalue.ts'], ['Z', 'machine/cpp/machine/cpu/upvalue.h'],
	['L', 'machine/ts/machine/cpu/closure.ts'], ['K', 'machine/cpp/machine/cpu/closure.h'], ['E', 'machine/cpp/machine/cpu/closure.cpp'],
	['F', 'machine/ts/machine/cpu/call_state.ts'], ['G', 'machine/cpp/machine/cpu/call_state.h'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts'],
] as const;

test('published GC sweep offsets agree with the compiler layout of the owning struct', () => {
	const path = 'machine/bios/kernel/gc_control.lua';
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([path, port]));
	const file = workspace.updateFile(path, readFileSync(path, 'utf8'));
	const objectFile = workspace.updateFile(port, readFileSync(port, 'utf8'));
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const statement = file.chunk.body.get(file.chunk.body.length - 1);
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	const exports = statement.expressions[0];
	assert.ok(exports.kind === LuaSyntaxKind.TableConstructorExpression);
	const internal = exports.fields.find(field => field.kind === LuaTableFieldKind.IdentifierKey && field.name === 'internal')?.value;
	assert.ok(internal?.kind === LuaSyntaxKind.TableConstructorExpression);
	const type = types.resolve(path, { name: 'gc_control', arrayLengths: [], span: statement.span });
	for (const name of ['white', 'object_count', 'sweep_link']) {
		const field = internal.fields.find(field => field.kind === LuaTableFieldKind.IdentifierKey && field.name === `${name}_offset`);
		assert.ok(field, name);
		const value = types.constants.evaluate(file, field.value);
		assert.ok(value?.kind === 'number');
		assert.equal(numberConstantValue(value.value), type.struct!.fields.get(name)!.offset, name);
	}
	const returnSpan = objectFile.chunk.body.get(objectFile.chunk.body.length - 1).span;
	const context = types.resolve(port, { name: 'object_sweep_context', arrayLengths: [], span: returnSpan });
	assert.equal(context.size, Sweep.ProtectedCapacity + 4);
	for (const [name, offset] of [['link', Sweep.Link], ['work', Sweep.Work], ['removed', Sweep.Removed],
		['deferred', Sweep.Deferred], ['allowance', Sweep.Allowance], ['mirror_policy', Sweep.MirrorPolicy],
		['action', Sweep.Action], ['header', Sweep.Header], ['next', Sweep.Next],
		['value_block', Sweep.ValueBlock], ['value_capacity', Sweep.ValueCapacity], ['frame_block', Sweep.FrameBlock],
		['frame_capacity', Sweep.FrameCapacity], ['protected_block', Sweep.ProtectedBlock], ['protected_capacity', Sweep.ProtectedCapacity]] as const) {
		const field = context.struct!.fields.get(name);
		assert.ok(field, name);
		assert.equal(field.offset, offset, name);
		assert.equal(field.size, 4, name);
	}
	for (const [name, action] of [['none', Action.None], ['compact_thread', Action.CompactThread],
		['retire_canonical_closure', Action.RetireCanonicalClosure], ['retire_thread_view', Action.RetireThreadView],
		['observe_retired_record', Action.ObserveRetiredRecord]] as const) {
		const decl = objectFile.decls.find(decl => decl.name === `action_${name}`);
		assert.ok(decl, name);
		const value = types.constants.constant(decl);
		assert.ok(value?.kind === 'number');
		assert.equal(numberConstantValue(value.value), action, name);
	}
});

test('the object sweep maps reachable work and separately identifies the deferred native scopes', () => {
	const sources = new Map<string, { lines: string[]; mapped: Set<number>; deferred: Set<number> }>();
	for (const [key, path] of pins) {
		const lines = execFileSync('git', ['show', basis + ':' + path], { encoding: 'utf8' }).split('\n');
		sources.set(key, { lines, mapped: new Set(), deferred: new Set() });
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
			const ref = sources.get(key);
			assert.ok(ref, `${port}:${index + 1}: unknown source ${key}`);
			const coverage = /\bpending = action_(?!none)|\bcontext.action = action_observe_retired_record/.test(line) ? ref.deferred : ref.mapped;
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= ref.lines.length, `${port}:${index + 1}: invalid origin ${entry}`);
				for (let n = first; n <= last; ++n) coverage.add(n);
			}
		}
	}
	const mapped = [
		['T', [[738, 773], [781, 782], [784, 787], [789, 792], [794, 797], [799, 802], [804, 805]]],
		['C', [[801, 835], [841, 847], [849, 853], [857, 857], [859, 864]]],
		['A', [[165, 173]]], ['B', [[73, 75], [508, 517]]],
		['L', [[42, 44], [50, 54]]], ['K', [[64, 66]]], ['E', [[68, 72]]],
		['I', [[118, 120], [122, 124], [128, 128], [130, 130]]], ['J', [[59, 64]]],
	] as const;
	const deferred = [
		['T', [[774, 779], [783, 783], [788, 788], [793, 793], [798, 798], [803, 803]]],
		['C', [[836, 839], [848, 848], [858, 858]]],
	] as const;
	// The common TS Thread view also samples scratch-only metadata. Dead
	// release consumes none of these values, and C++ never reads them here.
	const thread = sources.get('I')!;
	for (const [line, field] of [[121, 'offset'], [125, 'depth'], [126, 'protectedDepth'], [127, 'top'],
		[129, 'frameOffset'], [131, 'protectedOffset']] as const) {
		assert.ok(thread.lines[line - 1].trimStart().startsWith(`target.${field} = `));
		assert.equal(thread.mapped.has(line), false);
	}
	for (const [ranges, type] of [[mapped, 'mapped'], [deferred, 'deferred']] as const) {
		for (const [key, slices] of ranges) {
			const ref = sources.get(key)!;
			for (const [first, last] of slices) {
				for (let n = first; n <= last; ++n) {
					const source = ref.lines[n - 1];
					if (/^\s*(?:$|\/\/|}$)/.test(source)) continue;
					assert.ok(ref[type].has(n), `${key}:${n}: no ${type} BLua site for ${source.trim()}`);
				}
			}
		}
	}
});
