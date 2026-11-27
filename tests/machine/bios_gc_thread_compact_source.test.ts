import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const basis = '1a77f86de7ee9943612a729dc32f2534fda7b6a3';
const path = 'machine/bios/kernel/gc_thread_compact.lua';
const source = readFileSync(path, 'utf8');
const pins = [
	['T', 'machine/ts/machine/cpu/thread_record.ts'], ['C', 'machine/cpp/machine/cpu/thread_record.cpp'],
	['H', 'machine/cpp/machine/cpu/thread_record.h'], ['F', 'machine/ts/machine/cpu/call_state.ts'], ['G', 'machine/cpp/machine/cpu/call_state.h'],
	['L', 'machine/ts/machine/cpu/lua_heap.ts'], ['N', 'machine/cpp/machine/cpu/lua_heap.cpp'],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts'], ['B', 'machine/cpp/machine/cpu/heap_allocator.cpp'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts'],
] as const;

test('Thread/Frame views use the physical stack field offsets', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([path]));
	const file = workspace.updateFile(path, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const thread = types.resolve(path, { name: 'thread_compact_record', arrayLengths: [], span });
	const frame = types.resolve(path, { name: 'thread_compact_frame', arrayLengths: [], span });
	assert.equal(thread.size, ThreadField.FrameBlock + 4);
	assert.equal(frame.size, FRAME_CONTROL_BYTES);
	for (const [name, offset] of [
		['stack_top', ThreadField.StackTop], ['stack_block', ThreadField.StackBlock], ['stack_capacity', ThreadField.StackCapacity],
		['frame_capacity', ThreadField.FrameCapacity],
		['frame_depth', ThreadField.FrameDepth],
		['frame_block', ThreadField.FrameBlock],
	] as const) {
		const field = thread.struct!.fields.get(name);
		assert.ok(field, name);
		assert.equal(field.offset, offset, name);
		assert.equal(field.size, 4, name);
	}
	for (const [name, offset] of [['stack_base', FrameField.StackBase], ['stack_capacity', FrameField.StackCapacity]] as const) {
		const field = frame.struct!.fields.get(name);
		assert.ok(field, name);
		assert.equal(field.offset, offset, name);
		assert.equal(field.size, 4, name);
	}
});

test('Thread compaction maps each live shrink operation, not the growth path', () => {
	assert.ok(source.includes(`Source basis: ${basis}.`));
	const pinned = new Map<string, { lines: string[]; mapped: Set<number> }>();
	for (const [key, path] of pins) {
		const lines = execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' }).split('\n');
		pinned.set(key, { lines, mapped: new Set() });
	}
	const lines = source.split('\n');
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${path}:${index + 1}: missing source for ${line.trim()}`);
		for (const entry of mark[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const ref = pinned.get(key);
			assert.ok(ref, `${path}:${index + 1}: unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= ref.lines.length, `${path}:${index + 1}: invalid source ${entry}`);
				for (let number = first; number <= last; ++number) ref.mapped.add(number);
			}
		}
	}
	for (const [key, intervals] of [
		['T', [[118, 123], [125, 125], [127, 129], [132, 135], [156, 161], [163, 165], [170, 174], [199, 226], [229, 230]]],
		['C', [[91, 96], [101, 106], [111, 115], [145, 176], [179, 179]]],
		['L', [[272, 274], [293, 294]]], ['N', [[304, 308]]],
		['A', [[70, 72]]], ['B', [[68, 70]]],
	] as const) {
		const ref = pinned.get(key)!;
		for (const [first, last] of intervals) {
			for (let number = first; number <= last; ++number) {
				const text = ref.lines[number - 1];
				if (/^\s*(?:$|\/\/|[{}])/.test(text)) continue;
				assert.ok(ref.mapped.has(number), `${key}:${number} lacks a BLua operation for ${text.trim()}`);
			}
		}
	}
	for (const [key, first, last] of [['T', 166, 169], ['C', 97, 100], ['C', 107, 110]] as const) {
		for (let number = first; number <= last; ++number)
			assert.equal(pinned.get(key)!.mapped.has(number), false, `${key}:${number} belongs to the omitted growth branch`);
	}
});
