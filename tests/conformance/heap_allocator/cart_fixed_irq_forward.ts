import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AcceptedInterruptKind, CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { advanceRuntimeTime } from '../../../machine/ts/machine/runtime/cpu_executor';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_IRQ, CPU_CAUSE_NMI, CPU_EXCEPTION_TARGET_SOCKET_SHIFT, CPU_INTERRUPT_STATE_HALT, CPU_STATUS_MODE_STACK_MASK, CPU_STATUS_RFE_RESTORE_MASK } from '../../../machine/ts/spec/blua32/cop0';
import { IO_CART_SELECT, IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_DMA0_DONE, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_INTERRUPT_STATE_ADDRESS, CPU_IRQ_VECTOR_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import type { OptimizationLevel } from '../../../toolchain/ts/lua/compiler/optimizer';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const systemSource = `
local irq<const> = require('fixture/irq_words')
local slot<const> = mem[${IO_CART_SELECT}]
local endpoint<const>: *word = irq.target
*endpoint = mem32le[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET}]
	| (slot << ${CPU_EXCEPTION_TARGET_SOCKET_SHIFT})
local startup<const> = require('bmsx/startup')
cop0.irq_vector = startup.user_irq
` + TEST_CART_TRANSFER_SOURCE;
const irqWords = `module<const>
bss vector_target: word
bss system_cycles_marker: word
bss system_interrupt_sample: word
return { target = vector_target, marker = system_cycles_marker, sample = system_interrupt_sample }`;
const irqSource = `module<const>
local irq<const> = require('fixture/irq_words')
local note<const> = function()
	local pending<const>: *word = ${IO_IRQ_FLAGS}
	local report<const>: *word = irq.marker
	*report = *pending
end
local vector<const> = function()
	note()
	local sampled<const>: *word = irq.sample
	local accepted<const>: *word = ${CPU_INTERRUPT_STATE_ADDRESS}
	*sampled = *accepted
	local endpoint<const>: *word = irq.target
	cop0.exception_target = *endpoint
end
return { vector = vector, note = note }
`;

function buildCart(system: Uint8Array, optLevel: OptimizationLevel, handlerMarker: number) {
	const source = `
bss irq_report: word[7]
-- Establish ordinary frame and Value backing before the timed vector.
local function prime_leaf(first, second)
	irq_report[6] = first + second
end
local function prime_inner(first, second)
	prime_leaf(first, second)
	irq_report[6] = irq_report[6] + 1
end
local function prime(...)
	local first<const>, second<const> = ...
	prime_inner(first, second)
	irq_report[6] = irq_report[6] + 1
end
prime(mem[${IO_CART_SELECT}], ${Array.from({ length: 40 }, (_, i) => i + 1).join(', ')})
irq_report[6] = 0
function irq(flags)
	irq_report[0] = ${handlerMarker}
	irq_report[1] = flags
	irq_report[2] = cop0.epc
	irq_report[3] = cop0.status
	irq_report[4] = cop0.cause
	irq_report[5] = mem[${IO_CART_SELECT}]
	mem[${IO_IRQ_ACK}] = flags & mem[${IO_IRQ_MASK}]
end
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
halt_until_irq
irq_report[6] = 37
while true do halt_until_irq end
`;
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'cart.lua'), [], { entrySource: source, optLevel });
	const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	return { bytes: writeTestBlua32Rom(linked), image: linked.layout };
}

const exceptionSource = `
bss saved_nmi_epc: word
local report<const>: *word = saved_nmi_epc
*report = cop0.epc
`;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'cart-fixed-irq-forward-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const linked = linkManagedTestSystem(systemSource, optLevel, [
			{ path: 'fixture/irq_words', source: irqWords }, { path: 'fixture/user_irq', source: irqSource },
		], [], 'main', { exceptionSource, userIrqEntry: { path: 'fixture/user_irq', exportPathKey: 'vector' } });
		const system = writeTestBlua32Rom(linked);
		const other = buildCart(system, optLevel, 19), cart = buildCart(system, optLevel, 71);
		const expectedCartVector = readLE32(cart.bytes, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET);
		const report = cart.image.header.bssAddress;
		assert.equal(other.image.header.bssAddress, report, 'both cartridges report on the same RAM addresses');
		const declaration = (name: string) => linked.symbols.metadata.staticScopes.declarations.find(e => e.name === name)!.address!;
		const marker = declaration('system_cycles_marker'), target = declaration('vector_target');
		const sample = declaration('system_interrupt_sample'), nmiRecord = declaration('saved_nmi_epc');
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(other.bytes, cart.bytes), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler, irqController } = runtime.machine;
		memory.writeMappedWord(IO_CART_SELECT, 1);
		for (let slice = 0; slice < 256 && !cpu.isHaltedUntilIrq(); ++slice)
			scheduler.runCpuSlice(0, 1024, undefined, CpuRunKind.Scheduled);
		assert.equal(cpu.activeCartridgeSlot(), 1, 'the linked System boot runs the real selected slot-1 cart');
		assert.equal(cpu.isHaltedUntilIrq(), true, 'the armed cartridge has reached its first HALT');
		const userVector = memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS);
		assert.notEqual(userVector, readLE32(system, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET));
		assert.equal(memory.readRamRecordWord(target), (expectedCartVector | (1 << CPU_EXCEPTION_TARGET_SOCKET_SHIFT)) >>> 0);
		const ordinaryContext = cpu.activeThread.address, depth = cpu.getFrameDepth(), epc = cpu.readFramePc(depth - 1);
		const status = () => cpu.captureRuntimeState().statusWord;
		const pushStatus = (word: number) => ((word & ~CPU_STATUS_MODE_STACK_MASK) | ((word << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
		const popStatus = (word: number) => ((word & ~CPU_STATUS_RFE_RESTORE_MASK) | ((word >>> 2) & CPU_STATUS_RFE_RESTORE_MASK)) >>> 0;
		const irqStatus = pushStatus(status()), afterNmiStatus = popStatus(pushStatus(irqStatus));
		const flags = () => memory.readIoU32(IO_IRQ_FLAGS), select = () => memory.readIoU32(IO_CART_SELECT);
		const reportWords = () => Array.from({ length: 7 }, (_, i) => memory.readRamRecordWord(report + i * 4));
		const arena = cpu.heapAllocator, heap = cpu.luaHeap;
		const occupied = arena.occupiedBytes(), charged = heap.usedBytes();
		const seedPath = join(dir, `O${optLevel}.seed`), rom = join(dir, `O${optLevel}.rom`);
		const cart0 = join(dir, `O${optLevel}.0`), cart1 = join(dir, `O${optLevel}.1`);
		const trace = join(dir, `O${optLevel}.trace`), nativeState = join(dir, `O${optLevel}.native`);
		writeFileSync(rom, system);
		writeFileSync(cart0, other.bytes);
		writeFileSync(cart1, cart.bytes);
		writeFileSync(seedPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands = ['X'], wanted: string[] = [];
		function observe(cmd: string, value?: string | number) {
			commands.push(cmd);
			if (value !== undefined) wanted.push(String(value));
		}
		function hash(address: number, bytes: number) {
			const at = address - RAM_BASE;
			observe(`H ${at} ${at + bytes}`, hashBytes(memory.ramData(), at, bytes));
		}
		function advance(cycles: number) {
			advanceRuntimeTime(runtime, cycles);
			observe(`v ${cycles}`, scheduler.nowCycles);
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(arena.occupiedBytes(), occupied);
			assert.equal(heap.usedBytes(), charged);
			observe(`g ${cycles} 0`, `${result} ${paid} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
			if (paid > 0) advance(paid);
			return result;
		}
		// Start with a latched, masked DMA bit; VBlank arrives from the device clock.
		irqController.raise(IRQ_DMA0_DONE);
		observe(`i ${IRQ_DMA0_DONE}`);
		const started = scheduler.nowCycles;
		for (let step = 0; step < 256 && (flags() & IRQ_VBLANK) === 0; ++step)
			advance(scheduler.nextDeadline() - scheduler.nowCycles);
		assert.ok(scheduler.nowCycles > started);
		const pending = IRQ_DMA0_DONE | IRQ_VBLANK;
		assert.equal(flags(), pending);
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', 1);
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.readFrameFunctionAddress(0), userVector, 'the separately linked fixed System root executes');
		assert.equal(cpu.readEpcWord(), epc);
		assert.equal(status(), irqStatus);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), ordinaryContext);
		const accepted = (IRQ_VBLANK | CPU_INTERRUPT_STATE_HALT) >>> 0;
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), accepted);
		observe('Z', `${CPU_CAUSE_IRQ} 0 ${epc}`);

		const atAdmission = scheduler.nowCycles;
		for (let step = 0; step < 64 && memory.readRamRecordWord(marker) === 0; ++step)
			assert.equal(grant(1), RunResult.Yielded);
		assert.ok(scheduler.nowCycles > atAdmission, 'ordinary system instructions spend device cycles');
		assert.equal(memory.readRamRecordWord(marker), pending);
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		assert.deepEqual(reportWords(), [0, 0, 0, 0, 0, 0, 0]);
		assert.equal(flags(), pending, 'the firmware never acknowledges cart IRQs');
		memory.writeMappedWord(IO_CART_SELECT, 0);
		observe(`O ${IO_CART_SELECT} 0`);
		assert.equal(select(), 0);
		memory.writeMappedWord(IO_IRQ_MASK, IRQ_DMA0_DONE);
		observe(`O ${IO_IRQ_MASK} ${IRQ_DMA0_DONE}`);
		cpu.requestNonMaskableInterrupt();
		observe('N');
		assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.None);
		assert.equal(cpu.enterPendingInterrupt(), false);
		observe('I', 0);
		hash(marker, 4);
		assert.equal(memory.readRamRecordWord(sample), 0, 'pause before firmware samples the latched IRQ word');
		const beforeRefusal = scheduler.nowCycles, pausedPc = cpu.readFramePc(cpu.getFrameDepth() - 1);
		assert.equal(runtime.admitExternalCpuMutation(), false);
		assert.throws(() => runtime.callClosure(0), /requires a settled CPU and device frontier/);
		assert.throws(() => cpu.abortCompletionCall(0), /Fixed execution must retire/);
		assert.throws(() => runtime.rebootSystem(), /System IRQ must retire before reset/);
		assert.throws(() => cpu.reset(), /System IRQ must retire before reset/);
		assert.equal(scheduler.nowCycles, beforeRefusal);
		assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), pausedPc);
		assert.equal(cpu.readEpcWord(), epc);
		assert.equal(flags(), pending);
		assert.equal(select(), 0);
		observe('R', 'reset deferred');
		hash(CPU_INTERRUPT_STATE_ADDRESS, 4);
		hash(CPU_INTERRUPTED_CONTEXT_ADDRESS, 4);
		const checkpoint = captureRuntimeSaveState(runtime);
		observe(`x ${nativeState}`);
		observe('S');

		function finish() {
			for (let step = 0; step < 64 && cpu.activeThread.address === CPU_RESET_BANK_ADDRESS; ++step)
				assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.activeThread.address, ordinaryContext, 'the cart vector uses the retained ordinary bank');
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), 0);
			assert.equal(memory.readRamRecordWord(sample), accepted, 'the vector reads the accepted mask, not the changed controller mask');
			hash(sample, 4);
			assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.NonMaskable, 'pending NMI survives the fixed boundary');
			memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
			observe(`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`);
			assert.equal(cpu.activeCartridgeSlot(), 1, 'the transfer used the physical target, not SELECT');
			assert.equal(cpu.getFrameDepth(), depth + 1);
			assert.equal(cpu.readFrameFunctionAddress(depth), expectedCartVector);
			assert.equal(cpu.readEpcWord(), epc);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
			assert.equal(status(), irqStatus, 'does not enter a second IRQ');
			assert.equal(select(), 0);
			assert.equal(flags(), pending, 'no cart handler instruction has ACKed yet');
			assert.deepEqual(reportWords(), [0, 0, 0, 0, 0, 0, 0]);
			observe('P', `${depth + 1} ${cpu.readFramePc(depth)}`);
			observe('Z', `${CPU_CAUSE_IRQ} 0 ${epc}`);
			hash(CPU_INTERRUPTED_CONTEXT_ADDRESS, 4);

			// The deferred NMI can now interrupt the cartridge IRQ vector,
			// but its RFE must restore the earlier IRQ's latches.
			const cartIrqPc = cpu.readFramePc(depth);
			assert.equal(cpu.enterPendingInterrupt(), true);
			observe('I', 1);
			assert.equal(cpu.readEpcWord(), cartIrqPc);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_NMI);
			assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), ordinaryContext);
			assert.equal(cpu.getFrameDepth(), 1);
			observe('Z', `${CPU_CAUSE_NMI} 0 ${cartIrqPc}`);
			for (let step = 0; step < 64 && cpu.activeThread.address === CPU_RESET_BANK_ADDRESS; ++step)
				assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.readEpcWord(), epc);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
			assert.equal(cpu.readFramePc(depth), cartIrqPc);
			assert.equal(status(), afterNmiStatus);
			assert.equal(memory.readRamRecordWord(nmiRecord), cartIrqPc);
			observe('Z', `${CPU_CAUSE_IRQ} 0 ${epc}`);
			hash(nmiRecord, 4);

			for (let step = 0; step < 256 && cpu.getFrameDepth() !== depth; ++step)
				assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.getFrameDepth(), depth);
			assert.equal(cpu.readFramePc(depth - 1), epc, 'only cart vector RFE reaches the original EPC');
			assert.equal(status(), popStatus(afterNmiStatus));
			assert.deepEqual(reportWords(), [71, pending, epc, afterNmiStatus, CPU_CAUSE_IRQ, 0, 0]);
			assert.equal(flags(), IRQ_DMA0_DONE, 'cart ACK leaves the masked bit pending');
			assert.equal(select(), 0);
			observe(`M ${IO_CART_SELECT}`, '0 0');
			observe(`M ${IO_IRQ_FLAGS}`, `${IRQ_DMA0_DONE} 0`);
			hash(report, 28);
			assert.equal(grant(64), RunResult.Halted);
			assert.equal(cpu.activeCartridgeSlot(), 1);
			assert.equal(memory.readRamRecordWord(report + 24), 37);
			hash(report, 28);
		}
		finish();
		observe('U');
		applyRuntimeSaveState(runtime, checkpoint);
		finish();
		// A fatal exception-target fault, unlike an interrupted grant, cannot retire.
		// System reset must recover without reporting the reusable IRQ bank as a guest Thread.
		observe('U');
		applyRuntimeSaveState(runtime, checkpoint);
		memory.writeRamRecordWord(target, 0);
		observe(`W ${target} 0`);
		for (let step = 0; step < 64 && !cpu.captureRuntimeState().hardHalted; ++step) grant(1);
		assert.equal(cpu.captureRuntimeState().hardHalted, true);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.systemResetInhibited(), false);
		runtime.machine.systemController.requestReset();
		const resetStep = runtime.frameScheduler.stepInstruction(1);
		assert.equal(resetStep, InstructionStepResult.Advanced);
		assert.equal(runtime.machine.systemController.hasResetRequest(), false);
		const resetState = cpu.captureRuntimeState();
		assert.equal(resetState.hardHalted, false);
		assert.equal(resetState.activeThreadAddress, CPU_RESET_BANK_ADDRESS);
		assert.equal(resetState.previousActiveContextWord, ordinaryContext);
		assert.equal(memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS), 0);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		observe('r', `${resetStep} 0 0 ${CPU_RESET_BANK_ADDRESS} ${ordinaryContext}`);
		hash(CPU_INTERRUPTED_CONTEXT_ADDRESS, 12);
		writeFileSync(trace, commands.join('\n'));
		const have = execFileSync(native, [rom, trace, seedPath, cart0, cart1], { encoding: 'utf8' }).trimEnd().split('\n');
		const mismatch = have.findIndex((line, i) => line !== wanted[i]);
		assert.equal(mismatch, -1, `C++ observation ${mismatch}: ${have[mismatch]} != ${wanted[mismatch]}`);
		assert.equal(have.length, wanted.length);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		console.log(`CART-FIXED-IRQ-FORWARD:PASS O${optLevel} PCRTC, slot 1 behind SELECT=0, exact exception fields, device time, masked ACK, cross-core checkpoint`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
