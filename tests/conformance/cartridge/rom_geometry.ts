import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { IO_CART0_ROM_BYTE_COUNT, IO_CART1_ROM_BYTE_COUNT, IO_CART_SELECT, IO_SYS_ROM_BYTE_COUNT } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const selection = 0xa5a50001;
const source = `
local selected<const>: *word = ${IO_CART_SELECT}
local system<const>: *u32 = ${IO_SYS_ROM_BYTE_COUNT}
local socket0<const>: *u32 = ${IO_CART0_ROM_BYTE_COUNT}
local socket1<const>: *u32 = ${IO_CART1_ROM_BYTE_COUNT}
local data<const>: *u8 = ${CART_ROM_BASE}
*selected = 0x${selection.toString(16)}
return *system, *socket0, *socket1, *selected, *data
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const slot0 = Uint8Array.of(0x31, 0x42, 0x53, 0x64, 0x75);
const slot1 = Uint8Array.of(0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33);
const directory = mkdtempSync(join('tmp', 'bmsx-rom-geometry-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const rom = join(directory, 'sys.rom'), cart0 = join(directory, 'cart0.rom'), cart1 = join(directory, 'cart1.rom');
	const trace = join(directory, 'trace'), partial = join(directory, 'partial'), fromNative = join(directory, 'native');
	writeFileSync(cart0, slot0);
	writeFileSync(cart1, slot1);
	for (const optLevel of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'rom_geometry.lua').chunk, [], { entrySource: source, optLevel, programDomain: 'system' });
		const linked = linkTestSystemBlua32(compiled);
		assert.equal(linked.image.header.globalNameCount, 0);
		assert.deepEqual(linked.staticModulePaths, []);
		// The System bus has an odd fitted tail outside the linked program.
		const fitted = new Uint8Array(linked.romBytes.length + 7);
		fitted.set(linked.romBytes);
		// A boot ROM may designate its ordinary unwrapped function directly.
		writeLE32(fitted, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, linked.vectors.entryFunctionAddress);
		fitted.fill(0x4e, linked.romBytes.length);
		assert.ok(fitted.length > readLE32(fitted, BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET));
		writeFileSync(rom, fitted);

		const makeRuntime = () => new Runtime({ systemRomBytes: fitted, cartridgeSlots: cartridgeSlots(slot0, slot1), machineModel: PSX_MACHINE_SPEC }, input);
		const runtime = makeRuntime();
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const log: string[] = [], expected: string[] = [];
		const observe = (op: string, row?: string) => { log.push(op); if (row !== undefined) expected.push(row); };
		const grant = (cycles: number) => {
			const state = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.ok(paid > 0);
			observe(`J ${cycles} 1`, `${state} ${paid} 0 0 ${nativeHeapReference(cpu).heapAllocator.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
			return state;
		};
		const replay = (commands: readonly string[], rows: readonly string[]) => {
			writeFileSync(trace, commands.join('\n'));
			assert.deepEqual(execFileSync(native, [rom, trace, partial, cart0, cart1], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
		};
		assert.equal(cpu.getFrameDepth(), 1);
		assert.equal(memory.readMappedWord(IO_CART_SELECT), 0);
		observe('P', `1 ${cpu.readFramePc(0)}`);
		for (let i = 0; i < 16 && memory.readMappedWord(IO_CART_SELECT) === 0; ++i)
			assert.equal(grant(1), RunResult.Yielded);
		assert.equal(memory.readMappedWord(IO_CART_SELECT), selection);
		assert.equal(runtime.readCompletionValues().length, 0);
		observe(`M ${IO_CART_SELECT}`, `${selection} 0`);
		const mid = captureRuntimeSaveState(runtime);
		writeFileSync(partial, encodeRuntimeSaveState(mid));
		const prefix = log.splice(0), prefixRows = expected.splice(0);

		const finish = () => {
			assert.equal(grant(256), RunResult.Halted);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			const values = runtime.readCompletionValues();
			assert.deepEqual(values, [fitted.length, slot0.length, slot1.length, selection, slot1[0]].map(valueInteger));
			assert.equal(memory.readMappedWord(IO_CART_SELECT), selection);
			observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			observe(`M ${IO_CART_SELECT}`, `${selection} 0`);
		};
		finish();
		const tail = log.splice(0), tailRows = expected.splice(0);
		replay([...prefix, 'S', `x ${fromNative}`, ...tail, 'U', ...tail], [...prefixRows, ...tailRows, ...tailRows]);
		replay(['X', ...tail], tailRows);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(fromNative), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		assert.deepEqual(log, tail);
		assert.deepEqual(expected, tailRows);
		console.log(`ROM-GEOMETRY:PASS O${optLevel} ordinary System loads, exact grant parity and bidirectional checkpoint`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`ROM geometry evidence retained: ${directory}`);
	throw error;
}
