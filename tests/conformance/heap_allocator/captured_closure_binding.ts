import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
// Actual compiler output, deliberately more capture entries than all pinned Value slots.
const names = Array.from({ length: 513 }, (_, index) => `c${index}`);
const expect = names.length * 2;
const source = `
local function make(value)
	local ${names.join(',')} = ${names.map(() => 'value').join(',')}
	local function keep()
		local total = 0
		${names.map(name => `total = total + ${name}`).join('\n')}
		return total
	end
	return keep
end
local closure = make(2)
return closure()
`;

const boot = `cop0.exec = mem32le[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;

const folder = mkdtempSync(join('tmp', 'bmsx-captured-closure-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) for (const domain of ['system', 'cart'] as const) {
		const link = () => {
			if (domain === 'system') {
				const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel));
				return { layout: linked.image, system: linked.romBytes, cart: null };
			}
			const compiled = compileLuaChunkToProgram(parseLuaChunk(source), [], { entrySource: source, optLevel });
			const pair = linkTestBlua32Pair(compileHeapServiceSystem(boot, optLevel), compiled);
			return { layout: pair.cartImage, system: pair.systemRomBytes, cart: pair.cartRomBytes };
		};
		const { layout, system, cart } = link(), { textAddress } = layout.header;
		const target = layout.functions.find(fn => fn.upvalues.length === names.length);
		assert.ok(target);
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const arena = cpu.heapAllocator, latch = arena.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET;
		const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		function atIssue() {
			if (!cpu.getFrameDepth() || cpu.heapServiceActive() || cpu.activeCartridgeSlot() !== (domain === 'system' ? -1 : 0)) return false;
			const pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, pc);
			return instruction.op === OpCode.CLOSURE && instruction.bx * 16 === target!.address;
		}
		for (let i = 0; i < 8192 && !atIssue(); ++i)
			assert.notEqual(slice(cpu.heapServiceActive() ? 193 : 1), RunResult.Halted);
		assert.ok(atIssue());
		const stem = join(folder, `O${optLevel}-${domain}`);
		const rom = stem + '.rom', seed = stem + '.seed';
		const checkpoint = stem + '.checkpoint', cpp = stem + '.cpp';
		const issueCheckpoint = stem + '.issue-checkpoint', cppIssue = stem + '.issue-cpp';
		writeFileSync(rom, system);
		const cartMedia = cart === null ? [] : [stem + '.cart'];
		if (cart !== null) writeFileSync(cartMedia[0], cart);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands: string[] = [], rows: string[] = [];
		function grant(cycles: number) {
			const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
			commands.push(`J ${cycles} 1`);
			rows.push(`${result} ${spent} ${+cpu.heapServiceActive()} ${memory.readRamRecordWord(latch)} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return spent;
		}
		assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
		assert.ok(cpu.heapServiceActive());
		for (let n = 0; n < 8192; ++n) {
			const words = cpu.captureRuntimeState().capturedClosureOperands;
			assert.ok(words, `grant ${n}: capture still active (cause ${cpu.readCauseWord()}, reason ${cpu.readLuaFaultReasonWord()}, result ${cpu.heapServiceResult()})`);
			if (words[0].length > HEAP_SERVICE_VALUE_COUNT) break;
			grant(127);
		}
		const partial = captureRuntimeSaveState(runtime);
		const planes = partial.cpuState.capturedClosureOperands!;
		assert.ok(planes[0].length > HEAP_SERVICE_VALUE_COUNT && planes[0].length < names.length);
		assert.equal(planes[1].length, 0);
		writeFileSync(checkpoint, encodeRuntimeSaveState(partial));
		const split = commands.length, logicalBeforeReservation = cpu.luaHeap.usedBytes();
		for (let n = 0; n < 8192; ++n) {
			const words = cpu.captureRuntimeState().capturedClosureOperands;
			assert.ok(words);
			if (words[1].length > 32) break;
			grant(221);
		}
		const issued = captureRuntimeSaveState(runtime), issuedPlanes = issued.cpuState.capturedClosureOperands!;
		assert.equal(issuedPlanes[0].length, names.length);
		assert.ok(issuedPlanes[1].length > 32 && issuedPlanes[1].length < names.length);
		assert.equal(cpu.luaHeap.usedBytes(), logicalBeforeReservation,
			'partial reservation has not published logical ownership');
		writeFileSync(issueCheckpoint, encodeRuntimeSaveState(issued));
		const phase = commands.length;
		function drain() {
			for (let n = 0; n < 4096 && cpu.getFrameDepth(); ++n) grant(289);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(expect)]);
			commands.push('C');
			rows.push(String(expect));
			const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
			commands.push(`H ${first} ${last}`);
			rows.push(String(hashBytes(memory.ramData(), first, last - first)));
		}
		drain();
		const tail = commands.slice(split), after = rows.slice(split);
		function nativeCheck(name: string, state: string, trace: string[], expected: string[]) {
			const file = stem + name + '.trace';
			writeFileSync(file, trace.join('\n'));
			const actual = execFileSync(native, [rom, file, state, ...cartMedia], { encoding: 'utf8' }).trimEnd().split('\n');
			const mismatch = actual.findIndex((row, i) => row !== expected[i]);
			assert.equal(mismatch, -1, `${name} row ${mismatch}: TS ${expected[mismatch]} C++ ${actual[mismatch]}`);
			assert.equal(actual.length, expected.length);
		}
		nativeCheck('cold', seed, ['X', ...commands.slice(0, split), `x ${cpp}`,
			...commands.slice(split, phase), `x ${cppIssue}`, ...commands.slice(phase)], rows);
		nativeCheck('issue', issueCheckpoint, ['X', ...commands.slice(phase)], rows.slice(phase));
		const restoredIssue = decodeRuntimeSaveState(readFileSync(cppIssue), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(restoredIssue.cpuState.capturedClosureOperands, issuedPlanes);
		nativeCheck('restore', checkpoint, ['X', ...tail], after);
		const restored = decodeRuntimeSaveState(readFileSync(cpp), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(restored.cpuState.capturedClosureOperands, planes);
		applyRuntimeSaveState(runtime, restored);
		commands.length = rows.length = split;
		for (let i = split; i < phase; ++i) grant(221);
		drain();
		assert.deepEqual(commands.slice(split), tail);
		assert.deepEqual(rows.slice(split), after);
		console.log(`CAPTURED-CLOSURE:PASS O${optLevel} ${domain} (${names.length} captures; ${planes[0].length} prepared and ${issuedPlanes[1].length} issued in checkpoints; exact TS/C++ grants, RAM and portable restore)`);
	}
	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
