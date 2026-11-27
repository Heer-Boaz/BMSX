import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const module = 'machine/bios/kernel/thread_frame_storage.lua';
const basis = '1599e7a80b6c742d35333aff4c3b7bbde2671c64';
// Original host-derived view updates are not BIOS operations. The CPU now
// consumes physical backing at fixed activation retirement rather than
// accepting a per-Thread firmware command. Paired CALL/RET and sweep tests
// exercise that new boundary.
const reference = [
	['T', 'machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf', [[75, 80], [85, 86], [90, 98], [101, 106], [200, 238], [284, 285], [304, 306]]],
	['C', 'machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e', [[85, 91], [97, 98], [102, 109], [112, 116], [209, 246], [307, 310]]],
	['I', 'machine/ts/machine/cpu/thread_record.ts', '4d40495cd566545d52d5b1c4c1d6cfe615a61d13be3905fb645aa29203e9ae24', [[20, 24], [29, 29], [34, 34], [156, 197]]],
	['J', 'machine/cpp/machine/cpu/thread_record.cpp', '39a78c5506a1687c8be944a2177fd944717a72ca9cc5a271b16fd3c12fb35a2f', [[91, 140]]],
	['H', 'machine/cpp/machine/cpu/thread_record.h', 'f612d2139b3e6d7f5b26512ac24ee5fc85b641fee7000899c29323f7023ac5b5', [[14, 14], [20, 24], [27, 27]]],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', 'fc9c0c0e9f6db81f27a6725bf4ef5d7062fb9b4114df95e26afeb12c76ea4432', [[57, 59], [62, 62], [67, 69], [71, 72]]],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5', [[54, 56], [59, 59], [64, 66], [68, 69]]],
	['F', 'machine/ts/machine/cpu/call_state.ts', '727b44963ed45245d49cc19fefa6b13bedbd70d4de99ee3ccc56fb5620e066fb', [[21, 21]]],
	['G', 'machine/cpp/machine/cpu/call_state.h', '1e56478a5f909440593b8daa6d89b1ba406d06ab58eb94d6086f897daa8397e2', [[34, 34]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[9, 9]]],
	['L', 'machine/ts/machine/cpu/gc_heap.ts', '32e1e5788353e936e9868bc1cf8d3d1446e5808ea54480a5eaad0db2e40d37e2', [[1111, 1113], [1115, 1115], [1119, 1124]]],
	['N', 'machine/cpp/machine/cpu/gc_heap.cpp', 'bcace4a8618f7efdbc316a8a7498cc87c92c280bdce74b7f5bb8c774f9d450f9', [[1213, 1216], [1220, 1220], [1223, 1227]]],
	['P', 'machine/ts/spec/bmsx/heap_service.ts', 'f239c9fd46ff74e64a55153f7f453f9089f0c525dc5062ada0b69ce575b7cfe3', [[119, 120]]],
	['X', 'machine/ts/machine/cpu/cpu.ts', '5fccf17c0ed8da015a1b282d48a662e87237b03216ca4dc22f991dd9ce97f5ef', [[5197, 5208]]],
	['Y', 'machine/cpp/machine/cpu/cpu.cpp', '46169dd415322a9ca8b516a6ac80c6b9ed6f89d331c8c49ef78196e4dea2679e', [[2805, 2816]]],
	['S', 'machine/cpp/machine/cpu/cpu_heap_service.inl', 'a00310b5e9f6f1826f45fb69aa0507104d00acddd1c8337d457de033254e67a8', [[168, 184]]],
	['E', 'machine/ts/spec/blua32/cop0.ts', '87510e6e2325f1923a2d37d6d8b6ae0e45e36589d5615506f098fefb3513c4f1', [[43, 43]]],
	['V', 'machine/ts/machine/cpu/thread.ts', '0b7dcdb6c169fb0a40bf28e2bce71234dff1bdc9fcc1b561f1cdb6e48074c995', [[159, 166]]],
	['W', 'machine/cpp/machine/cpu/thread.cpp', '77a033bfa8db2c25fcc2601f13d5271443758049fc6c6301f57b40cf51479a75', [[181, 189]]],
] as const;

test('Thread backing firmware preserves the source and shared raw descriptors', () => {
	const text = readFileSync(module, 'utf8').replaceAll('\r\n', '\n');
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([module]));
	const parsed = workspace.updateFile(module, text);
	const span = parsed.chunk.body.get(parsed.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layout = types.resolve(module, { name: 'thread_storage_record', arrayLengths: [], span });
	assert.equal(layout.size, ThreadField.FrameBlock + 4);
	for (const [field, offset] of [
		['stack_block', ThreadField.StackBlock], ['stack_capacity', ThreadField.StackCapacity], ['frame_block', ThreadField.FrameBlock],
		['frame_capacity', ThreadField.FrameCapacity], ['frame_depth', ThreadField.FrameDepth], ['protected_depth', ThreadField.ProtectedDepth],
		['stack_top', ThreadField.StackTop], ['error_word', ThreadField.ErrorWord], ['error_tag', ThreadField.ErrorKind],
	] as const) {
		const member = layout.struct!.fields.get(field);
		assert.ok(member, field);
		assert.equal(member.offset, offset, field);
		assert.equal(member.size, 4, field);
	}

	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [label, path, digest] of reference) {
		const source = execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, path);
		sources.set(label, { lines: source.split('\n'), covered: new Set() });
	}
	assert.ok(text.includes(`-- Source basis: ${basis}.`));
	const lines = text.split('\n'), exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${module}:${index + 1}: missing source for ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [label, intervals] = entry.split(':');
			const source = sources.get(label);
			assert.ok(source, entry);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= source.lines.length, entry);
				for (let n = first; n <= last; ++n) source.covered.add(n);
			}
		}
	}
	for (const [label, , , intervals] of reference) {
		const source = sources.get(label)!;
		for (const [first, last] of intervals) for (let n = first; n <= last; ++n) {
			const line = source.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}];?$)/.test(line)) continue;
			assert.ok(source.covered.has(n), `${label}:${n}: not mapped: ${line.trim()}`);
		}
	}
});
