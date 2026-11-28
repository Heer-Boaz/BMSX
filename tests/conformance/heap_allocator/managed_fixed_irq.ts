import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_IRQ, CPU_INTERRUPT_STATE_HALT, CPU_STATUS_USER_MODE_CURRENT } from '../../../machine/ts/spec/blua32/cop0';
import { IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_DMA0_DONE, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_FRAME_ADDRESS, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_INTERRUPT_STATE_ADDRESS, CPU_IRQ_VECTOR_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = (user: boolean) => `
bss report: word
local body<const> = function(seed)
	local retained<const> = seed + 8
	*report = 1
	${user ? `cop0.status = cop0.status | ${CPU_STATUS_USER_MODE_CURRENT}` : ''}
	halt_until_irq
	*report = retained
	return retained
end
${user ? `cop0.irq_vector = mem[${BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET}]` : ''}
local co<const> = require('coroutine').create(body)
local coroutine_entries<const> = require('bmsx/startup')
local ok<const>, value<const> = blua32.closure(coroutine_entries.coroutine_resume)(co, 33)
if not ok then return -1 end
return value
`;
const irqSource = (user: boolean) => `
bss selected_context: word
local interrupted<const>: *word = ${CPU_INTERRUPTED_CONTEXT_ADDRESS}
*selected_context = *interrupted
${user ? 'cop0.irq_vector = cop0.system_vector' : ''}
` + readFileSync('machine/bios/kernel/irq.lua', 'utf8');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

const dir = mkdtempSync(join(tmpdir(), 'managed-fixed-irq-'));
try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const optLevel of [0, 3] as const) for (const user of [false, true]) {
		const mode = user ? 'User' : 'Supervisor';
		const linked = linkManagedTestSystem(source(user), optLevel, COROUTINE_FIRMWARE_MODULES, [], 'main', { irqSource: irqSource(user) });
		const rom = writeTestBlua32Rom(linked);
		const vector = readLE32(rom, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET);
		const irq = linked.layout.functions.find(fn => fn.address === vector)!;
		const symbol = (name: string) => linked.symbols.metadata.staticScopes.declarations.find(e => e.name === name)!.address!;
		const report = symbol('report'), selectedContext = symbol('selected_context'), dma = symbol('bios_dma_completion_sequence'), vblank = symbol('bios_vblank_count');
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler, irqController } = runtime.machine;
		// Boot the real O0/O3 firmware through its paid reset and coroutine entry.
		for (let grant = 0; grant < 32 && !cpu.isHaltedUntilIrq(); ++grant)
			scheduler.runCpuSlice(0, 65_536, undefined, CpuRunKind.Scheduled);
		assert.equal(cpu.isHaltedUntilIrq(), true, JSON.stringify({
			mode, optLevel, cause: cpu.readCauseWord(), reason: cpu.readLuaFaultReasonWord(),
			pc: cpu.readCurrentInstructionPc(), epc: cpu.readEpcWord(), active: cpu.activeThread.address,
			root: cpu.rootThread.address, depth: cpu.getFrameDepth(), report: memory.readRamRecordWord(report),
		}));
		assert.equal(memory.readRamRecordWord(report), 1, 'a real managed coroutine halted: ' + JSON.stringify({
			cause: cpu.readCauseWord(), reason: cpu.readLuaFaultReasonWord(), pc: cpu.readCurrentInstructionPc(),
			root: cpu.rootThread.address, active: cpu.activeThread.address, irq: memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS), report,
			stack: cpu.activeThread.frameDepth,
		}));
		assert.equal(memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS), user ? vector : 0);
		const replacement = cpu.captureRuntimeState().systemVectorWord;
		assert.notEqual(vector, replacement);
		const retained = cpu.activeThread.address, root = cpu.rootThread.address;
		assert.notEqual(retained, root);
		assert.notEqual(retained, CPU_RESET_BANK_ADDRESS);
		assert.notEqual(root, CPU_RESET_BANK_ADDRESS);
		const depth = cpu.getFrameDepth(), epc = cpu.readFramePc(depth - 1);
		const stack = memory.readRamRecordWord(retained + ThreadField.StackBlock);
		const frameBlock = memory.readRamRecordWord(retained + ThreadField.FrameBlock);
		const frameCapacity = memory.readRamRecordWord(retained + ThreadField.FrameCapacity);
		const arena = nativeHeapReference(cpu).heapAllocator, heap = nativeHeapReference(cpu).luaHeap;
		while (arena.allocate(8192, true)) { /* occupy each large extent */ }
		while (arena.allocate(24, true)) { /* then occupy the small extents */ }
		assert.equal(arena.allocate(24, true), 0, 'a real arena reservation is refused');

		const seed = captureRuntimeSaveState(runtime);
		const romPath = join(dir, `${mode}-O${optLevel}.rom`), seedPath = join(dir, `${mode}-O${optLevel}.state`);
		const nativeState = join(dir, `${mode}-O${optLevel}.native`), script = join(dir, `${mode}-O${optLevel}.trace`);
		writeFileSync(romPath, rom);
		writeFileSync(seedPath, encodeRuntimeSaveState(seed));
		const commands = ['X'], want: string[] = [];
		function observe(cmd: string, outcome?: string | number) {
			commands.push(cmd);
			if (outcome !== undefined) want.push(String(outcome));
		}
		function physicalState() {
			for (const address of [CPU_IRQ_VECTOR_ADDRESS, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_INTERRUPT_STATE_ADDRESS, retained + ThreadField.StackBlock, retained + ThreadField.FrameBlock, retained + ThreadField.FrameCapacity, dma, vblank, report, selectedContext]) {
				const offset = address - RAM_BASE;
				observe(`H ${offset} ${offset + 4}`, hashBytes(memory.ramData(), offset, 4));
			}
			observe(`M ${IO_IRQ_FLAGS}`, `${memory.readIoU32(IO_IRQ_FLAGS)} 0`);
			assert.equal(memory.readRamRecordWord(retained + ThreadField.StackBlock), stack);
			assert.equal(memory.readRamRecordWord(retained + ThreadField.FrameBlock), frameBlock);
			assert.equal(memory.readRamRecordWord(retained + ThreadField.FrameCapacity), frameCapacity);
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			observe(`E ${cycles}`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		}
		const occupied = arena.occupiedBytes(), used = heap.usedBytes(), oldDma = memory.readRamRecordWord(dma), oldVblank = memory.readRamRecordWord(vblank);
		const pending = IRQ_DMA0_DONE | IRQ_VBLANK;
		function raiseIrq() {
			memory.writeMappedWord(IO_IRQ_MASK, pending);
			irqController.raise(pending);
			observe(`O ${IO_IRQ_MASK} ${pending}`);
			observe(`i ${pending}`);
		}
		raiseIrq();
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', 1);
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), retained);
		assert.equal(memory.readRamRecordWord(CPU_RESET_BANK_ADDRESS + ThreadField.FrameBlock), CPU_FIXED_FRAME_ADDRESS);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), (pending | CPU_INTERRUPT_STATE_HALT) >>> 0);
		assert.equal(cpu.readFramePc(0), irq.codeAddress);
		assert.equal(cpu.getFrameDepth(), 1);
		assert.equal(cpu.readEpcWord(), epc);
		assert.equal(cpu.hasFramesAbove(retained, depth), true);
		observe('P', `1 ${irq.codeAddress}`);
		observe('Z', `${CPU_CAUSE_IRQ} 0 ${epc}`);
		assert.equal(arena.occupiedBytes(), occupied);
		assert.equal(heap.usedBytes(), used);
		physicalState();

		for (let step = 0; step < 64 && memory.readRamRecordWord(dma) === oldDma; ++step)
			assert.equal(grant(1), RunResult.Yielded);
		assert.equal(memory.readRamRecordWord(dma), oldDma + 1);
		assert.equal(memory.readRamRecordWord(selectedContext), retained);
		assert.equal(memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS), user ? replacement : 0, 'the active bank does not depend on the programmed User IRQ vector');
		assert.equal(memory.readRamRecordWord(vblank), oldVblank);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS), pending, 'checkpoint remains before the ACK');
		assert.equal(CPU_INTERRUPTED_CONTEXT_ADDRESS >= memory.ramBusEnd(), true, 'the load used protected RAM, not the ordinary aperture');
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		physicalState();
		const checkpoint = captureRuntimeSaveState(runtime);
		observe(`x ${nativeState}`);
		observe('S');

		function finishVector() {
			for (let grantNumber = 0; grantNumber < 64 && cpu.activeThread.address === CPU_RESET_BANK_ADDRESS; ++grantNumber)
				assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.activeThread.address, retained);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), 0);
			assert.equal(cpu.hasFramesAbove(retained, depth), false);
			assert.equal(cpu.getFrameDepth(), depth);
			assert.equal(cpu.readFramePc(depth - 1), epc, 'resume the exact retained frame at EPC');
			assert.equal(memory.readRamRecordWord(dma), oldDma + 1);
			assert.equal(memory.readRamRecordWord(vblank), oldVblank + 1);
			assert.equal(memory.readIoU32(IO_IRQ_FLAGS), 0);
			assert.equal(arena.occupiedBytes(), occupied);
			assert.equal(heap.usedBytes(), used);
			assert.equal(memory.readRamRecordWord(report), 1, 'no early instruction in the retained coroutine');
			observe('P', `${depth} ${epc}`);
			physicalState();
			let run = RunResult.Yielded;
			for (let slice = 0; slice < 32 && run === RunResult.Yielded; ++slice) run = grant(512);
			assert.equal(run, RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(41)]);
			observe('C', 41);
		}
		finishVector();
		applyRuntimeSaveState(runtime, checkpoint);
		observe('U');
		finishVector();
		applyRuntimeSaveState(runtime, seed);
		observe('X');
		cpu.clearHaltUntilIrq();
		observe('h');
		raiseIrq();
		// Admit from inside the ordinary run loop, rather than the HALT path.
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), retained);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), pending, 'an IRQ accepted while running did not wake HALT');
		finishVector();

		writeFileSync(script, commands.join('\n'));
		const result = execFileSync(native, [romPath, script, seedPath], { encoding: 'utf8' }).trimEnd().split('\n');
		const mismatch = result.findIndex((line, i) => line !== want[i]);
		assert.equal(mismatch, -1, `native row ${mismatch}: ${result[mismatch]} != ${want[mismatch]}`);
		assert.equal(result.length, want.length);
		const portableCheckpoint = decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		applyRuntimeSaveState(runtime, portableCheckpoint);
		finishVector();
		applyRuntimeSaveState(runtime, portableCheckpoint);
		const before = scheduler.nowCycles;
		assert.equal(runtime.cpuExecution.runSuspendedUntilDepth(depth, 1, retained), CpuSuspendedRunResult.Yielded);
		assert.ok(scheduler.nowCycles > before);
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(runtime.cpuExecution.runSuspendedUntilDepth(depth, 256, retained), CpuSuspendedRunResult.Completed);
		assert.equal(cpu.activeThread.address, retained);
		assert.equal(cpu.readFramePc(depth - 1), epc);
		assert.equal(memory.readRamRecordWord(report), 1, 'suspended stepping stops at RFE');
		console.log(`MANAGED-FIXED-IRQ:PASS ${mode} O${optLevel} full arena, original coroutine/stack retained, protected RAM & mapped ACK, grants, suspended RFE, portable restore`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
