import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AcceptedInterruptKind, CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_PACE_PAID, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { ThreadField, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/machine/cpu/thread_record';
import { valueTable } from '../../../machine/ts/machine/cpu/value';
import { advanceRuntimeTime, CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	CPU_CAUSE_IRQ, CPU_CAUSE_NMI, CPU_STATUS_MODE_STACK_MASK, CPU_STATUS_RFE_RESTORE_MASK,
} from '../../../machine/ts/spec/blua32/cop0';
import { HEAP_SERVICE_IRQ_FORWARD_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_OFFSET, HEAP_SERVICE_VALUE_COUNT, HeapServiceIrqForwardField } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_CART_SELECT, IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_DMA0_DONE, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import {
	BLUA32_IMAGE_DATA_ADDRESS_OFFSET, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
} from '../../../machine/ts/spec/blua32/image_format';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const systemSource = `function exception(error) end
local floor<const> = require('kernel/heap_floor')
local image<const> = ${CART_ROM_BASE} + mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET}]
local data_end<const> = mem[image + ${BLUA32_IMAGE_DATA_ADDRESS_OFFSET}] + mem[image + ${BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET}]
local bss_end<const> = mem[image + ${BLUA32_IMAGE_BSS_ADDRESS_OFFSET}] + mem[image + ${BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET}]
cop0.ram_end = floor.admit_static_end(data_end > bss_end and data_end or bss_end)
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
const cartSource = `bss irq_report: word[6]
local ack<const>: *word = ${IO_IRQ_ACK}
local mask<const>: *word = ${IO_IRQ_MASK}
function irq(flags)
	irq_report[0] = irq_report[0] + 1
	irq_report[1] = flags
	irq_report[2] = cop0.epc
	irq_report[3] = cop0.status
	irq_report[4] = cop0.cause
	irq_report[5] = 71
	*ack = flags & *mask
end
while true do halt_until_irq end`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
// The sampler and latch immediately follow the previous completed epoch.
const epochWork = GC_LAST_EPOCH_WORK - 4, sampled = GC_LAST_EPOCH_WORK + 4, assist = GC_LAST_EPOCH_WORK + 8;
const pushStatus = (word: number) => ((word & ~CPU_STATUS_MODE_STACK_MASK) | ((word << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
const popStatus = (word: number) => ((word & ~CPU_STATUS_RFE_RESTORE_MASK) | ((word >>> 2) & CPU_STATUS_RFE_RESTORE_MASK)) >>> 0;
const deadStringText = 'an IRQ maintenance pass should reclaim this String';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-production-irqs-'));
try {
	const proveGeneratedTrace = process.env.BMSX_TEST_PINNED_NATIVE_PROFILE === '1';
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		configure: proveGeneratedTrace ? ['-DBMSX_NATIVE_GATE_PROFILE=ON'] : [],
	});
	for (const optLevel of [0, 3] as const) {
		const bios = compileHeapServiceSystem(systemSource, optLevel);
		const cart = (entrySource: string) => compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel });
		const pair = linkTestBlua32Pair(bios, cart(cartSource));
		const other = linkTestBlua32Pair(bios, cart(cartSource.replace('= 71', '= 73')));
		const systemObject = encodeCompiledProgramObject(bios);
		const exported = systemObject.sections.rodata.moduleExports.find(item => item.path === 'kernel/gc_table_trace'
			&& item.exportPathKey === 'trace_table_edges')!;
		const targetIndex = pair.systemSymbols.metadata.functionIds.indexOf(systemObject.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(targetIndex >= 0, 'the linked System image contains the Table trace export');
		const target = pair.systemImage.functions[targetIndex];
		let nativeTraceCycles = 0, nativeTraceEntries = 0;
		const media = { systemRomBytes: pair.systemRomBytes, cartridgeSlots: cartridgeSlots(pair.cartRomBytes, other.cartRomBytes), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(media, input);
		runtime.boot();
		const { cpu, memory, scheduler, irqController } = runtime.machine, { gc, heapAllocator: arena } = cpu;
		const frames = runtime.frameScheduler, management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const forward = management + HEAP_SERVICE_IRQ_FORWARD_OFFSET;
		const lane = () => memory.readRamRecordWord(forward + HeapServiceIrqForwardField.CartLane);
		const word = (offset: number) => memory.readRamRecordWord(control + offset);
		const report = pair.cartImage.header.bssAddress;
		const readReport = () => Array.from({ length: 6 }, (_, index) => memory.readRamRecordWord(report + 4 * index));
		const flags = () => memory.readIoU32(IO_IRQ_FLAGS);
		const status = () => cpu.captureRuntimeState().statusWord;

		for (let i = 0; i < 256 && !cpu.isHaltedUntilIrq(); ++i) scheduler.runCpuSlice(0, 1024, undefined, CpuRunKind.Scheduled);
		assert.equal(cpu.activeCartridgeSlot(), 0);
		assert.equal(cpu.isHaltedUntilIrq(), true, 'real EXEC reaches the cartridge HALT');
		assert.equal(cpu.heapServiceActive(), false);
		const live = cpu.createTable(49152, 0), dead = cpu.createTable(0, 0);
		cpu.setGlobalByKey(cpu.stringPool.intern('live through cartridge IRQ pressure'), valueTable(live));
		assert.ok(cpu.stringPool.intern(deadStringText) >= RAM_BASE);
		while (arena.unoccupiedBytes() > 32 * HEAP_PAGE_SIZE) assert.ok(arena.allocate(HEAP_PAGE_SIZE - 8, true));
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(word(sampled), 0);
		const callerDepth = cpu.getFrameDepth(), callerPc = () => cpu.readFramePc(callerDepth - 1);
		memory.writeMappedWord(IO_CART_SELECT, 1); // Data selection does not retarget a program IRQ.
		const bootPath = join(directory, `system-O${optLevel}.rom`);
		const cartPath = join(directory, `cart-O${optLevel}.rom`), secondCartPath = join(directory, `other-O${optLevel}.rom`);
		writeFileSync(bootPath, pair.systemRomBytes);
		writeFileSync(cartPath, pair.cartRomBytes);
		writeFileSync(secondCartPath, other.cartRomBytes);
		const trace: string[] = [], expected: string[] = [];
		const observe = (cmd: string, result?: string | number) => { trace.push(cmd); if (result !== undefined) expected.push(String(result)); };
		const seed = join(directory, `seed-O${optLevel}.state`);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		observe('X');

		function markMemory(first: number, end: number) {
			observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
		}
		function mask(word: number) { memory.writeMappedWord(IO_IRQ_MASK, word); observe(`O ${IO_IRQ_MASK} ${word}`); }
		function physicalEdge() {
			const start = scheduler.nowCycles;
			for (let i = 0; i < 256 && (flags() & IRQ_VBLANK) === 0; ++i) {
				const delta = scheduler.nextDeadline() - scheduler.nowCycles;
				advanceRuntimeTime(runtime, delta);
				observe(`v ${delta}`, scheduler.nowCycles);
			}
			assert.ok(scheduler.nowCycles > start);
			assert.equal(flags() & IRQ_VBLANK, IRQ_VBLANK, 'the real PCRTC edge latches VBlank');
			assert.equal(cpu.heapServiceActive(), false, 'no device/frame injection');
		}
		function irqAdmission() {
			const pc = callerPc(), irqStatus = pushStatus(status());
			assert.equal(cpu.enterPendingInterrupt(), true);
			observe('I', 1);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(lane(), 1);
			assert.equal(memory.readRamRecordWord(forward + HeapServiceIrqForwardField.Vector), pair.cartVectors.irqFunctionAddress);
			assert.equal(cpu.getFrameDepth(), callerDepth, 'the ordinary cart vector is not yet pushed');
			assert.equal(cpu.isHaltedUntilIrq(), false, 'one accepted IRQ consumes HALT');
			assert.equal(cpu.readEpcWord(), pc);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
			assert.equal(status(), irqStatus);
			observe('Z', `${CPU_CAUSE_IRQ} 0 ${pc}`);
			return { pc, irqStatus };
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			observe(`L ${cycles}`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
			if (proveGeneratedTrace) trace.push('n');
			return result;
		}
		function finishPrelude(shortGrants = false) {
			let tested = false;
			for (let i = 0; i < 16384 && cpu.heapServiceActive(); ++i) {
				if (shortGrants && !tested) {
					const depth = memory.readRamRecordWord(management + HEAP_SERVICE_THREAD_OFFSET + ThreadField.FrameDepth);
					const frame = management + HEAP_SERVICE_FRAME_OFFSET + (depth - 1) * FRAME_CONTROL_BYTES;
					if (memory.readRamRecordWord(frame + FrameField.Function) === target.address) {
						for (let j = 0; j < 16; ++j) {
							assert.equal(grant(1), RunResult.CollectionProgress);
							markMemory(management + HEAP_SERVICE_THREAD_OFFSET,
								management + HEAP_SERVICE_VALUE_OFFSET + THREAD_STACK_SLOT_BYTES * HEAP_SERVICE_VALUE_COUNT);
						}
						tested = true;
					}
				}
				assert.equal(grant(4096), RunResult.CollectionProgress);
			}
			if (shortGrants) assert.ok(tested, 'pause in the linked Table trace itself');
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(lane(), 0);
			assert.equal(cpu.getFrameDepth(), callerDepth + 1);
		}
		function deliver({ pc, irqStatus }: { pc: number; irqStatus: number }, count: number, bits: number, pendingAfterAck: number) {
			assert.equal(flags(), bits, 'BIOS did not acknowledge any pending source');
			assert.equal(readReport()[0], count - 1);
			assert.equal(grant(4096), RunResult.Halted);
			assert.equal(cpu.isHaltedUntilIrq(), true);
			assert.equal(status(), popStatus(irqStatus));
			assert.equal(cpu.getFrameDepth(), callerDepth);
			assert.deepEqual(readReport(), [count, bits, pc, irqStatus, CPU_CAUSE_IRQ, 71]);
			assert.equal(flags(), pendingAfterAck);
			markMemory(report - RAM_BASE, report - RAM_BASE + 24);
			observe(`M ${IO_IRQ_FLAGS}`, `${pendingAfterAck} 0`);
		}

		// An IRQ from another source can deliver the complete raw FLAGS word
		// while leaving a masked VBlank pending and collector state alone.
		mask(IRQ_DMA0_DONE);
		physicalEdge();
		assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.None);
		irqController.raise(IRQ_DMA0_DONE);
		observe(`i ${IRQ_DMA0_DONE}`);
		const maskedPc = irqAdmission();
		function settleSuspended(cycles: number) {
			const before = scheduler.nowCycles;
			const result = runtime.cpuExecution.runSuspendedUntilDepth(callerDepth, cycles);
			const elapsed = scheduler.nowCycles - before;
			assert.ok(elapsed > 0);
			observe(`q ${callerDepth} ${cycles}`, `${result} ${elapsed} ${+cpu.heapServiceActive()} ${cpu.getFrameDepth()} ${callerPc()} ${+cpu.isHaltedUntilIrq()}`);
			return result;
		}
		assert.equal(settleSuspended(1), CpuSuspendedRunResult.Yielded, 'admitted firmware owns time at unchanged ordinary depth');
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(readReport()[0], 0, 'cart vector cannot run before the firmware retires');
		assert.equal(flags(), IRQ_VBLANK | IRQ_DMA0_DONE, 'firmware did not acknowledge any pending source');
		// The first cart vector can also need BIOS frame backing.
		assert.equal(settleSuspended(65_536), CpuSuspendedRunResult.Completed);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.getFrameDepth(), callerDepth);
		assert.equal(callerPc(), maskedPc.pc, 'stop after RFE before the next ordinary instruction');
		assert.equal(cpu.isHaltedUntilIrq(), false);
		assert.equal(status(), popStatus(maskedPc.irqStatus));
		assert.deepEqual(readReport(), [1, IRQ_VBLANK | IRQ_DMA0_DONE, maskedPc.pc, maskedPc.irqStatus, CPU_CAUSE_IRQ, 71]);
		assert.equal(flags(), IRQ_VBLANK);
		markMemory(report - RAM_BASE, report - RAM_BASE + 24);
		observe(`M ${IO_IRQ_FLAGS}`, `${IRQ_VBLANK} 0`);
		assert.equal(word(sampled), 0);
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(grant(4096), RunResult.Halted); // Separately resume the parked cart body.
		assert.equal(cpu.isHaltedUntilIrq(), true);

		// The same latched VBlank, now enabled, owns the full BIOS quantum.
		mask(IRQ_VBLANK);
		const occupied = arena.occupiedBytes();
		const issue = irqAdmission();
		assert.equal(word(sampled), 0, 'admission itself executes no collector work');
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		assert.equal(frames.stepInstruction(1), InstructionStepResult.Advanced);
		const elapsed = scheduler.nowCycles - before;
		assert.ok(elapsed > 0 && elapsed <= 8);
		observe('d', `${InstructionStepResult.Advanced} ${elapsed} ${+(frames.lastTickSequence !== tick)} 0 0 1 0 ${IRQ_VBLANK} ${occupied} ${cpu.luaHeap.usedBytes()}`);
		assert.equal(cpu.heapServiceActive(), true);
		const partialPath = join(directory, `partial-O${optLevel}.state`), nativePath = join(directory, `native-O${optLevel}.state`);
		const partial = captureRuntimeSaveState(runtime);
		writeFileSync(partialPath, encodeRuntimeSaveState(partial));
		trace.push(`x ${nativePath}`);
		const replayStart = trace.length, expectedStart = expected.length;
		cpu.requestNonMaskableInterrupt();
		observe('N');
		assert.equal(cpu.enterPendingInterrupt(), false, 'an accepted prelude excludes reentry including NMI');
		observe('I', 0);
		finishPrelude(true);
		assert.equal(word(sampled), occupied);
		assert.equal(word(assist), 1);
		assert.equal(word(epochWork), GC_STEP_WORDS);
		assert.equal(gc.phase(), GcPhase.Mark);
		assert.equal(cpu.enterPendingInterrupt(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_NMI);
		observe('I', 1);
		deliver({ pc: issue.pc, irqStatus: popStatus(pushStatus(issue.irqStatus)) }, 2, IRQ_VBLANK, 0);

		function run(name: string, commands: readonly string[], checkpoint: string) {
			const script = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(script, commands.join('\n'));
			const rows = execFileSync(native, [bootPath, script, checkpoint, cartPath, secondCartPath], { encoding: 'utf8' }).trimEnd().split('\n');
			let previousEntries = 0, previousCycles = 0;
			return rows.filter(row => {
				if (!row.startsWith('native-firmware ')) return true;
				const [entries, cycles, lastPc] = row.slice('native-firmware '.length).split(' ').map(Number);
				if (lastPc >= target.codeAddress && lastPc < target.codeAddress + target.codeByteCount) {
					nativeTraceEntries += entries - previousEntries;
					nativeTraceCycles += cycles - previousCycles;
				}
				previousEntries = entries;
				previousCycles = cycles;
				return false;
			});
		}
		assert.deepEqual(run('ts-checkpoint', ['X', ...trace.slice(replayStart)], partialPath), expected.slice(expectedStart));
		assert.deepEqual(run('native', trace, seed), expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(lane(), 1);
		assert.equal(cpu.readEpcWord(), issue.pc);
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false);
		finishPrelude();
		assert.equal(cpu.enterPendingInterrupt(), true);
		deliver({ pc: issue.pc, irqStatus: popStatus(pushStatus(issue.irqStatus)) }, 2, IRQ_VBLANK, 0);

		// With Mark already active, HALT lends four work units per base
		// quantum. The next IRQ eventually completes Atomic before forwarding.
		physicalEdge();
		const nextPc = irqAdmission();
		finishPrelude();
		assert.equal(word(epochWork), 5 * GC_STEP_WORDS);
		assert.equal(word(GC_PACE_PAID), 5 * GC_STEP_WORDS);
		deliver(nextPc, 3, IRQ_VBLANK, 0);
		let count = 3;
		for (let i = 0; i < 32 && gc.phase() !== GcPhase.Pause; ++i) {
			physicalEdge();
			const issuePc = irqAdmission();
			finishPrelude();
			assert.notEqual(gc.phase(), GcPhase.Atomic, 'Atomic final mark is finished before cart dispatch');
			assert.equal(cpu.queuedFixedWork(), 0, 'the IRQ-owned final mark does not post a second activation');
			deliver(issuePc, ++count, IRQ_VBLANK, 0);
		}
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(gc.tableRecordAddress(live), live);
		assert.equal(gc.tableRecordAddress(dead), 0);
		assert.equal(cpu.stringPool.find(deadStringText), undefined);

		// Also accept the interrupt inside an ordinary run-loop grant,
		// rather than via the stopped CPU's out-of-grant IRQ admission.
		const insidePath = join(directory, `inside-O${optLevel}.state`);
		const inside = captureRuntimeSaveState(runtime);
		writeFileSync(insidePath, encodeRuntimeSaveState(inside));
		applyRuntimeSaveState(runtime, inside);
		const insideTrace = trace.length, insideExpected = expected.length;
		physicalEdge();
		cpu.clearHaltUntilIrq();
		observe('h');
		const issuePc = callerPc(), irqStatus = pushStatus(status());
		for (let i = 0; i < 2 && lane() === 0; ++i) {
			const clock = scheduler.nowCycles, display = frames.lastTickSequence;
			assert.equal(frames.stepInstruction(1), InstructionStepResult.Advanced);
			assert.equal(scheduler.nowCycles, clock, 'admission alone is not a CPU instruction');
			observe('d', `${InstructionStepResult.Advanced} 0 ${+(frames.lastTickSequence !== display)} 0 0 ${+cpu.heapServiceActive()} 0 ${IRQ_VBLANK} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		}
		assert.equal(lane(), 1);
		assert.equal(cpu.readEpcWord(), issuePc);
		assert.equal(cpu.captureRuntimeState().interruptEventPending, true, 'an IRQ accepted while running retains its wake event');
		finishPrelude();
		deliver({ pc: issuePc, irqStatus }, count + 1, IRQ_VBLANK, 0);
		assert.deepEqual(run('inside-dispatch', ['X', ...trace.slice(insideTrace)], insidePath), expected.slice(insideExpected));

		if (proveGeneratedTrace) {
			assert.ok(nativeTraceEntries > 0 && nativeTraceCycles > 0, 'the linked Table trace entered timed native firmware');
			console.log(`O${optLevel}: ${nativeTraceEntries} native entries, ${nativeTraceCycles} charged cycles in grants whose last native entry was in Table trace`);
		}
		console.log(`BIOS-GC-PRESSURE-IRQ:PASS O${optLevel} (real EXEC, VBlank masking/ACK, cart forwarding, suspended RFE boundary, NMI, portable rewind, Atomic and sweep)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
