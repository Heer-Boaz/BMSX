import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_FUNCTION_RESERVED_OFFSET, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const port = 'machine/bios/kernel/root_activation.lua';
const basis = '81ad6e973c36256da0c4a3052551be75988cee2f';
const sources = {
	C: ['machine/cpp/machine/cpu/cpu.cpp', 'ec6b0d4ba3de41ed5ed72e4c576f5e431265378ebcf7996a4b1ecb605186d0eb'],
	T: ['machine/ts/machine/cpu/cpu.ts', '72c08041ee82d51e1ff4a2a8e364b17ec1fe9858fcd0e1c1dc4076d127e24036'],
	F: ['machine/ts/spec/blua32/image_format.ts', 'c60839f38c8ef13b57310c84d576da48d127715b8b2cb6b2aed3ea69a5559cf5'],
	S: ['machine/cpp/machine/cpu/call_state.h', 'd0c7a2afbcc4b287d2c1d3830d6484eab1f41e0e670b31787a13e5f743480d31'],
	Q: ['machine/ts/machine/cpu/call_state.ts', '23e1aecb673364007f4924560fb38fc28cab335e16601e761cfb05b123977cc6'],
	I: ['machine/ts/machine/cpu/thread_record.ts', '85a1bd9f2ba7e0369bdd0d6741d7cea694caf9fd092e0c4e0bf9c65ed37db518'],
	J: ['machine/ts/machine/cpu/thread.ts', '9cf05a8045563e90b074b796ee7f6bc15de1d2ffc94abbef5073223689a4c9f2'],
	N: ['machine/cpp/machine/cpu/thread.h', '2ecd971dac2c7693e0b1f3c421dfc7b12917ac59ae923be5dbefe6c7349a89f9'],
	E: ['machine/cpp/machine/cpu/closure.h', 'ef85f807bc81dc47034d15cabcf80bffd408c4e9f890827fcabbf11af8512663'],
	P: ['machine/cpp/machine/cpu/frame_placement.h', '0537a87b5386a632bb273b3c1700ef389b760e6fbe2d18fd1a5ea3dfc6678785'],
	V: ['machine/ts/machine/cpu/value_slots.ts', '5392a460b99ca64717c81da1574bad1df8353a5c2133fb37ddab528d640cbe70'],
} as const;

test('authored System root covers the published writes of the pinned direct-entry implementations', () => {
	// Admission, image latching, and host-view invalidation have different
	// owners. The producer consumes a fresh, already admitted zero-arg bank.
	verifyPinnedBluaSource(port, basis, sources, [
		['F', 31, 38], ['S', 118, 131], ['Q', 64, 79], ['E', 24, 24],
		['C', 1904, 1906], ['C', 1908, 1910], ['T', 2234, 2236], ['T', 2238, 2239],
		['N', 21, 21], ['N', 29, 29],
	]);
});

test('authored System root uses the physical Function, Frame and Thread fields', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const { chunk } = workspace.updateFile(port, readFileSync(port, 'utf8'));
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layouts = [
		['system_entry_record', BLUA32_FUNCTION_RECORD_SIZE, {
			code: BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, code_size: BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
			formals: BLUA32_FUNCTION_NUM_PARAMS_OFFSET, maximum: BLUA32_FUNCTION_MAX_STACK_OFFSET,
			flags: BLUA32_FUNCTION_FLAGS_OFFSET, captures: BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
			capture_count: BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, reserved: BLUA32_FUNCTION_RESERVED_OFFSET,
		}],
		['initial_frame', FRAME_CONTROL_BYTES, {
			fn: FrameField.Function, call_site: FrameField.CallSite, open_head: FrameField.OpenHead, protected: FrameField.Protected, flags: FrameField.Flags, pc: FrameField.Pc,
			vararg_base: FrameField.VarargBase, argument_count: FrameField.ArgumentCount, return_base: FrameField.ReturnBase, return_count: FrameField.ReturnCount, top: FrameField.Top,
			closure: FrameField.Closure, stack_base: FrameField.StackBase, stack_capacity: FrameField.StackCapacity,
		}],
		['activation_thread', ThreadField.ProtectedBlock, {
			status: ThreadField.Status, stack_top: ThreadField.StackTop, stack_block: ThreadField.StackBlock, stack_capacity: ThreadField.StackCapacity,
			frame_depth: ThreadField.FrameDepth, protected_depth: ThreadField.ProtectedDepth, frame_block: ThreadField.FrameBlock,
		}],
	] as const;
	for (const [name, size, fields] of layouts) {
		const layout = types.resolve(port, { name, arrayLengths: [], span: chunk.body.get(0).span }).struct!;
		assert.equal(layout.size, size, name);
		for (const [field, offset] of Object.entries(fields)) assert.equal(layout.fields.get(field)?.offset, offset, `${name}.${field}`);
	}
});
