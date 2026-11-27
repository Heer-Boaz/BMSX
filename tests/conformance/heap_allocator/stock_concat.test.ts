import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes, hashText } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool, valueFloatBits, valueInteger, valueNil, valuePayload, valueTag, valueToByteString, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_FRAME_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { test } from 'node:test';

const floats = [0x00000001, 0x7f7fffff, 0x80000000, 0x7fc12345, 0xff800000, 0x3f800000, 0x3dcccccd, 0x497423f8, 0x4b18967f];
const source = `
local lead, trail = 'begin\\x00\\xfe/', '/end'
local result
for index = 1, 2 do
	result = lead .. (-2147483647 - 1) .. ${floats.map(bits => 'blua32.float_from_bits(0x' + bits.toString(16) + ')').join(' .. ')} .. false .. nil .. trail
end
return #result
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('ordinary cartridge concatenation preserves bytes and a full-arena intern hit across portable saves', async t => {
	mkdirSync('tmp', { recursive: true });
	const output = mkdtempSync(join('tmp', 'stock-concat-'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(output, 'native') });
	let complete = false;
	try {
		for (const optLevel of [0, 3] as const) await t.test(`O${optLevel}`, () => {
			const { images } = compileCartlibProgram(source, { optLevel });
			const target = images.systemSymbols.metadata.functionIds.findIndex(id =>
				id.startsWith('module:kernel/bios_concat/') && id.endsWith('|constant|intern_concat'));
			assert.notEqual(target, -1);
			const functionAddress = images.systemImage.functions[target].address;
			const systemPath = join(output, 'system.rom'), cartPath = join(output, 'cart.rom');
			writeFileSync(systemPath, images.systemRomBytes);
			writeFileSync(cartPath, images.cartRomBytes);
			const runtime = new Runtime({ systemRomBytes: images.systemRomBytes,
				cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, stringPool: pool } = cpu;
			const serviceFrame = arena.managementOffset() + HEAP_SERVICE_FRAME_OFFSET;
			const entry = () => {
				for (let grant = 0; grant < 250000; ++grant) {
					scheduler.runCpuSlice(0, 73, undefined, CpuRunKind.Scheduled);
					const frame = cpu.getFrameDepth() - 1;
					if (cpu.heapServiceActive() && memory.readRamRecordWord(serviceFrame + FrameField.Function) === functionAddress
						&& cpu.readFrameExecutionDomain(frame) >= 0) return frame;
				}
				assert.fail(`missing BIOS concatenation (cause=${cpu.readCauseWord()}, Lua fault=${cpu.readLuaFaultReasonWord()})`);
			};
			const finish = (frame: number, commands: string[], want: string[]) => {
				const register = memory.readRamRecordWord(serviceFrame + FrameField.ReturnBase);
				for (let grant = 0; grant < 16000 && cpu.heapServiceActive(); ++grant) {
					const result = scheduler.runCpuSlice(0, 73, undefined, CpuRunKind.Scheduled);
					commands.push('E 73');
					want.push([result, 73 - cpu.instructionBudgetRemaining, Number(cpu.heapServiceActive()),
						memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
				}
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(cpu.readLuaFaultReasonWord(), 0);
				const result = cpu.readFrameRegister(frame, register);
				assert.equal(valueTag(result), ValueTag.String);
				const address = valuePayload(result), first = address - RAM_BASE;
				const end = first + BLUA32_STRING_RECORD_HEADER_SIZE + pool.byteLength(address);
				commands.push(`H ${first} ${end}`);
				want.push(String(hashBytes(memory.ramData(), first, end - first)));
				return address;
			};
			const replay = (frame: number) => {
				scheduler.runCpuSlice(0, 73, undefined, CpuRunKind.Scheduled);
				assert.ok(cpu.heapServiceActive(), 'checkpoint is inside the firmware call');
				const state = join(output, 'partial.ts'), nativeState = join(output, 'partial.native');
				const trace = join(output, 'trace');
				writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
				const commands = ['X', `x ${nativeState}`], want: string[] = [];
				const record = finish(frame, commands, want);
				writeFileSync(trace, commands.join('\n'));
				const actual = execFileSync(native, [systemPath, trace, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n');
				assert.deepEqual(actual, want);
				applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState),
					PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
				const rerun: string[] = [];
				assert.equal(finish(frame, [], rerun), record);
				assert.deepEqual(rerun, want);
				return record;
			};
			const original = entry();
			const expected = 'begin\x00\xfe/' + [valueInteger(-2147483648), ...floats.map(valueFloatBits), valueBool(false), valueNil()]
				.map(value => valueToByteString(value, pool)).join('') + '/end';
			const before = arena.occupiedBytes();
			const record = replay(original);
			assert.ok(arena.occupiedBytes() > before, 'a miss reserved the result');
			assert.equal(pool.bytes(record), expected);
			assert.equal(memory.readRamRecordWord(record + BLUA32_STRING_LENGTH_OFFSET), expected.length);
			assert.equal(memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET), hashText(expected));

			const second = entry();
			for (let bytes = MAIN_RAM_SIZE >>> 1; bytes >= 16; bytes >>>= 1)
				while (arena.allocate(bytes, true)) { /* exhaust physical backing */ }
			const full = arena.occupiedBytes();
			assert.equal(replay(second), record);
			assert.equal(arena.occupiedBytes(), full, 'an intern hit does not reserve another record');
		});
		complete = true;
	} finally {
		if (complete) rmSync(output, { recursive: true, force: true });
		else t.diagnostic(`Concat evidence retained in ${output}`);
	}
});
