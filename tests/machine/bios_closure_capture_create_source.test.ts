import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CLOSURE_CAPTURE_WORDS, CLOSURE_PROTOTYPE_ADDRESS } from '../../machine/ts/machine/cpu/closure';
import { GC_RECORD_LINK } from '../../machine/ts/machine/cpu/gc_object';
import { UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { HEAP_SERVICE_FIRMWARE_DATA_OFFSET, HeapServiceCaptureBindingField } from '../../machine/ts/spec/bmsx/heap_service';
import { RUNTIME_MANAGEMENT_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const file = 'machine/bios/kernel/closure_capture_create.lua';
const basis = '08c4a76d41e49d689c13a47fed3de37cece84072';
const reference = [
	['T', 'machine/ts/machine/cpu/cpu.ts', 'da10e03c2b011c0762b1fef02aca59c80701c11284c6d91ed893e942a22f5e42', [[567, 592], [1228, 1228], [2985, 2985], [4075, 4079], [4084, 4086], [4100, 4110], [4112, 4125], [4127, 4127]]],
	['C', 'machine/cpp/machine/cpu/cpu.cpp', '6ebe53fa29d516e9144facdf08f639d19ac562354eca3fad0c63941ae0316340', [[158, 163], [590, 590], [2975, 3000], [3005, 3005], [3039, 3048], [3050, 3061], [3065, 3065]]],
	['L', 'machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf', [[243, 245], [248, 270], [283, 285]]],
	['R', 'machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e', [[250, 252], [255, 276], [286, 288]]],
	['S', 'machine/ts/machine/cpu/closure.ts', 'dccda2a02992d7ad7a04ae4ee78b46ae7d310b6cf19d787252d73af3cf40d024', [[35, 43], [50, 65], [72, 81]]],
	['N', 'machine/cpp/machine/cpu/closure.cpp', '989524624c0955ea61dde1cfe19a2e5bc6476902194c7117d95c1dc12c7a86c6', [[18, 32]]],
	['U', 'machine/ts/machine/cpu/upvalue.ts', '0b41b1f352162642d61ac6f050169ec41056909a15af40da584e6f5896f1b130', [[9, 13], [15, 18], [20, 35]]],
	['V', 'machine/cpp/machine/cpu/upvalue.cpp', 'b16e89ab4093c50af6e7e33485a2170f81359fda63b43401cd48fdb2a37c3635', [[23, 38]]],
	['F', 'machine/ts/machine/cpu/call_state.ts', '727b44963ed45245d49cc19fefa6b13bedbd70d4de99ee3ccc56fb5620e066fb', [[19, 19], [22, 22], [51, 52], [103, 103], [106, 108]]],
	['H', 'machine/cpp/machine/cpu/call_state.h', '1e56478a5f909440593b8daa6d89b1ba406d06ab58eb94d6086f897daa8397e2', [[33, 33], [37, 37], [128, 128]]],
	['P', 'machine/ts/machine/cpu/gc_heap.ts', '32e1e5788353e936e9868bc1cf8d3d1446e5808ea54480a5eaad0db2e40d37e2', [[102, 102], [147, 155], [159, 163], [167, 168], [176, 178]]],
	['Q', 'machine/cpp/machine/cpu/gc_heap.cpp', 'bcace4a8618f7efdbc316a8a7498cc87c92c280bdce74b7f5bb8c774f9d450f9', [[235, 244], [253, 256], [288, 294]]],
	['D', 'machine/ts/spec/blua32/image_format.ts', 'd2f3d690faa89da542f2b2bcc49daaa3cdda0c6edbface508ba894ff1ea09959', [[44, 45]]],
	['I', 'machine/cpp/spec/blua32/image_format.h', 'd82ee3f5580bb06ce9269e0e5c4b5d32f76985c84a8a5074483a90be630a1111', [[50, 51]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[7, 7]]],
	['E', 'machine/ts/spec/blua32/cop0.ts', '87510e6e2325f1923a2d37d6d8b6ae0e45e36589d5615506f098fefb3513c4f1', [[43, 44]]],
	['J', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3', [[5, 7], [9, 9], [12, 12]]],
	['K', 'machine/cpp/machine/cpu/closure.h', 'ef85f807bc81dc47034d15cabcf80bffd408c4e9f890827fcabbf11af8512663', [[61, 62], [85, 86]]],
	['B', 'machine/cpp/machine/cpu/closure.cpp', '989524624c0955ea61dde1cfe19a2e5bc6476902194c7117d95c1dc12c7a86c6', [[68, 71], [74, 75], [78, 79]]],
] as const;

test('captured Closure storage layout and source mapping cover both native mirrors', () => {
	const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([file]));
	const parsed = workspace.updateFile(file, text);
	const span = parsed.chunk.body.get(parsed.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layouts = [
		['closure_binding', HeapServiceCaptureBindingField.Count + 4, [['prototype', HeapServiceCaptureBindingField.Prototype], ['domain', HeapServiceCaptureBindingField.Domain], ['binding_flags', HeapServiceCaptureBindingField.BindingFlags],
			['code', HeapServiceCaptureBindingField.Code], ['params', HeapServiceCaptureBindingField.Params], ['stack', HeapServiceCaptureBindingField.Stack], ['flags', HeapServiceCaptureBindingField.Flags],
			['descriptors', HeapServiceCaptureBindingField.Descriptor], ['count', HeapServiceCaptureBindingField.Count]]],
		['closure_record', CLOSURE_CAPTURE_WORDS, [['kind', 0], ['gray', GC_RECORD_LINK], ['prototype', CLOSURE_PROTOTYPE_ADDRESS]]],
		['open_cell', UPVALUE_HEAP_BYTES, [['slot', UPVALUE_VALUE_WORD], ['owner', UPVALUE_OWNER], ['next', UPVALUE_NEXT]]],
		['closure_frame', FRAME_CONTROL_BYTES, [['open_head', FrameField.OpenHead], ['closure', FrameField.Closure],
			['stack_base', FrameField.StackBase], ['stack_capacity', FrameField.StackCapacity]]],
		['closure_tail', 24, [['code', 0], ['params', 4], ['stack', 8], ['flags', 12], ['descriptors', 16], ['count', 20]]],
	] as const;
	for (const [name, bytes, fields] of layouts) {
		const layout = types.resolve(file, { name, arrayLengths: [], span });
		assert.equal(layout.size, bytes, name);
		for (const [field, offset] of fields) {
			const member = layout.struct!.fields.get(field);
			assert.ok(member, `${name}.${field}`);
			assert.equal(member.offset, offset, `${name}.${field}`);
			assert.equal(member.size, 4, `${name}.${field}`);
		}
	}

	const scratch = types.resolve(file, { name: 'closure_work', arrayLengths: [], span });
	assert.ok(HEAP_SERVICE_FIRMWARE_DATA_OFFSET + scratch.size <= RUNTIME_MANAGEMENT_SIZE);
	const planes = [['resolved', 0, 4096], ['new_cells', 4096, 4096], ['missing', 8192, 128]] as const;
	for (const [name, offset, size] of planes) {
		const field = scratch.struct!.fields.get(name)!;
		assert.equal(field.offset, offset);
		assert.equal(field.size, size);
	}

	assertMappedSource(file, text, basis, reference);
});

type SourceReference = readonly [string, string, string, readonly (readonly [number, number])[]];
function assertMappedSource(file: string, text: string, commit: string, refs: readonly SourceReference[]): void {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [label, path, digest] of refs) {
		const source = execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, path);
		sources.set(label, { lines: source.split('\n'), covered: new Set() });
	}
	assert.ok(text.includes(`-- Source basis: ${commit}.`));
	const lines = text.split('\n'), exports = lines.findIndex(line => line.startsWith('return {'));
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${file}:${index + 1}: missing source for ${line.trim()}`);
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
	for (const [label, , , intervals] of refs) {
		const source = sources.get(label)!;
		for (const [first, last] of intervals) for (let n = first; n <= last; ++n) {
			const line = source.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$)/.test(line)) continue;
			assert.ok(source.covered.has(n), `${label}:${n}: not mapped: ${line.trim()}`);
		}
	}
}

test('captured Closure admission and retry are mapped to both native mirrors', () => {
	const file = 'machine/bios/kernel/allocate_captured_closure.lua';
	assertMappedSource(file, readFileSync(file, 'utf8'), 'b6e4bb3362386c5c2cf4b7f7e0ef2b6045f340f1', [
		['H', 'machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf', [[75, 81], [85, 98], [104, 106], [243, 249], [272, 273]]],
		['C', 'machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e', [[85, 93], [97, 109], [115, 116], [250, 256], [278, 279]]],
		['G', 'machine/ts/machine/cpu/gc_heap.ts', 'f677c8ce0a75cf0a121535013677788e696a6c02eb8a5248cbc2422f7f1c65dd', [[1119, 1125]]],
		['R', 'machine/cpp/machine/cpu/gc_heap.cpp', '5642ff30f0f11c4d573e539045e1a37fa718f246ac69f796b930d01b7eb6165c', [[1223, 1229]]],
		['T', 'machine/ts/machine/cpu/cpu.ts', '3a1e89f106e5183e4595461f44ecd1e5e6dca9d0659bddbb3bec050089b9fbe3', [[4151, 4155], [4188, 4197]]],
		['N', 'machine/cpp/machine/cpu/cpu.cpp', '36919b7031dc597971b652617e9fcbbe1a61181d5f32730c7ec2d080f35d3ca0', [[3012, 3013], [3055, 3068]]],
	]);
});
