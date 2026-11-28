import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { bindReferenceDlmalloc } from '../../helpers/native_heap/dlmalloc_wasm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { closureRecordBytes } from '../../../machine/ts/machine/cpu/closure';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valueNil, valueString } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { COP0_EXEC, COP0_RAM_END, COP0_STATUS, CPU_CAUSE_CODE_SYSCALL, CPU_STATUS_INHIBIT_RESET } from '../../../machine/ts/spec/blua32/cop0';
import { GC_TRACE_CONTEXT_OFFSET, GcTraceContextField, HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import {
	IO_CART_SELECT, IO_SYS_CONTROL, SYS_CONTROL_RESET,
} from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_FRAME_ADDRESS, CPU_INTERRUPTED_CONTEXT_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkRawTestSystemBlua32, linkTestCartBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { admitTestHeapServiceCpu } from '../../helpers/heap_service_system';
import { MANAGED_CART_LAUNCH } from '../../helpers/managed_cart_launch';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';

const cartSource = 'bss records: word[0x10000]\nrecords[0] = 37\nreturn records[0]';
const sentinel = 0x5eedaa55;
const maxInstructionCycles = Math.max(...BASE_CYCLES);

// An in-image transfer with already reserved frame storage needs neither
// target image materialization nor a heap Closure for the entry.
function verifyFullArenaTransfer(native: string, directory: string) {
	const code = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(code, 1, OpCode.MTC0, 0, COP0_EXEC, 0);
	writeInstruction(code, 2, OpCode.HALT, 0, 0, 0);
	writeInstruction(code, 3, OpCode.KSMI, 0, 0, 37);
	writeInstruction(code, 4, OpCode.RET, 0, 2, 0);
	const system = linkRawTestSystemBlua32({ text: code, constants: [integerConstant(0)], functions: [
		{ firstWord: 0, wordCount: 3, maxStack: 1 },
		{ firstWord: 3, wordCount: 2, numParams: 2, maxStack: 2, staticClosure: true },
	] });
	const target = system.image.functions[1];
	writeLE32(system.romBytes, system.image.header.constantTableAddress + BLUA32_CONSTANT_PAYLOAD_OFFSET, target.address);
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, scheduler, memory, executionAddressSpace } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator;
	admitTestHeapServiceCpu(cpu, executionAddressSpace);
	const minimum = closureRecordBytes(0, false);
	for (let bytes = arena.unoccupiedBytes(); bytes >= minimum; bytes >>>= 1) {
		while (arena.allocate(bytes, true) !== 0) { /* Reserved backing, not reclaimable objects. */ }
	}
	while (arena.allocate(minimum, true) !== 0) { /* Exhaust every block that could hold a Closure. */ }
	const occupied = arena.occupiedBytes(), charged = nativeHeapReference(cpu).luaHeap.usedBytes();
	const seed = join(directory, 'full-arena.state'), trace = join(directory, 'full-arena.trace'), rom = join(directory, 'full-arena.rom');
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands = ['X'], expected: string[] = [];
	function grant(cycles: number, expectedResult: RunResult, paid: number) {
		assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), expectedResult);
		assert.equal(cycles - cpu.instructionBudgetRemaining, paid);
		assert.equal(arena.occupiedBytes(), occupied);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), charged);
		commands.push(`J ${cycles} 1`);
		expected.push(`${expectedResult} ${paid} 0 ${occupied} ${charged}`);
	}
	grant(1, RunResult.Yielded, BASE_CYCLES[OpCode.LOADK]);
	grant(1, RunResult.Yielded, BASE_CYCLES[OpCode.MTC0]);
	const frame = cpu.rootThread.frameAtDepth(0), offset = frame.controlOffset;
	assert.equal(frame.functionAddress, target.address);
	assert.equal(frame.pc, target.codeAddress);
	assert.equal(frame.closureAddress, 0);
	assert.equal(frame.top, 2);
	assert.equal(frame.registers.get(0), valueNil());
	assert.equal(frame.registers.get(1), valueNil());
	commands.push(`H ${offset} ${offset + FRAME_CONTROL_BYTES}`);
	expected.push(String(hashBytes(memory.ramData(), offset, FRAME_CONTROL_BYTES)));
	grant(64, RunResult.Halted, BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.RET] + 1);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
	commands.push('C');
	expected.push('37');
	writeFileSync(rom, system.romBytes);
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [rom, trace, seed], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	console.log('BIOS-EXEC-DIRECT:PASS same-image transfer with no free block for a Closure');
}


// Observe a real reset request with no firmware service active between the
// aperture register write and the ordinary control instruction that releases it.
function verifyMaskedReset(native: string, directory: string) {
	const report = DYNAMIC_RAM_BASE;
	const end = report + 0x8000;
	const text = new Uint8Array(14 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.MFC0, 0, COP0_STATUS, 0);
	writeInstruction(text, 1, OpCode.LOADK, 1, 0, 0);
	writeInstruction(text, 2, OpCode.BOR, 0, 0, 1);
	writeInstruction(text, 3, OpCode.MTC0, 0, COP0_STATUS, 0);
	writeInstruction(text, 4, OpCode.LOADK, 2, 0, 1);
	writeInstruction(text, 5, OpCode.MTC0, 2, COP0_RAM_END, 0);
	writeInstruction(text, 6, OpCode.LOADK, 2, 0, 2);
	writeInstruction(text, 7, OpCode.KSMI, 3, 0, 7);
	writeInstruction(text, 8, OpCode.STORE_MEM_D, 3, 2, MemoryAccessKind.U32LE);
	writeInstruction(text, 9, OpCode.BNOT, 1, 1, 0);
	writeInstruction(text, 10, OpCode.BAND, 0, 0, 1);
	writeInstruction(text, 11, OpCode.MTC0, 0, COP0_STATUS, 0);
	writeInstruction(text, 12, OpCode.KSMI, 3, 0, 13);
	writeInstruction(text, 13, OpCode.STORE_MEM_D, 3, 2, MemoryAccessKind.U32LE);
	const system = linkRawTestSystemBlua32({
		text, constants: [integerConstant(CPU_STATUS_INHIBIT_RESET), integerConstant(end), integerConstant(report)],
		functions: [{ firstWord: 0, wordCount: 14, maxStack: 4 }],
	});
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, scheduler, memory, systemController } = runtime.machine;
	const commands: string[] = [], expected: string[] = [];
	for (let i = 0; i < 4096 && memory.ramBusEnd() !== end; ++i) {
		const run = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		commands.push('E 1');
		expected.push([run, 1 - cpu.instructionBudgetRemaining, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
	}
	assert.equal(memory.ramBusEnd(), end);
	assert.equal(cpu.systemResetInhibited(), true);
	memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	commands.push(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
	assert.equal(systemController.hasResetRequest(), true);
	let proceededWithResetPending = false;
	const frames = runtime.frameScheduler;
	for (let i = 0; i < 64 && systemController.hasResetRequest(); ++i) {
		const cycles = scheduler.nowCycles, tick = frames.lastTickSequence;
		const completed = frames.runCyclesToNextLogicalTick(1);
		commands.push('p 1');
		expected.push([+completed, scheduler.nowCycles - cycles, frames.lastTickSequence - tick, +cpu.isHaltedUntilIrq()].join(' '));
		const seen = memory.readRamRecordWord(report);
		assert.notEqual(seen, 13, 'accept RESET before executing the successor of the releasing MTC0');
		if (seen === 7 && systemController.hasResetRequest()) proceededWithResetPending = true;
		commands.push(`H ${report - RAM_BASE} ${report - RAM_BASE + 4}`);
		expected.push(String(hashBytes(memory.ramData(), report - RAM_BASE, 4)));
	}
	assert.equal(proceededWithResetPending, true, 'guest execution proceeds while the request remains latched');
	assert.equal(systemController.hasResetRequest(), false);
	assert.equal(cpu.systemResetInhibited(), false);
	assert.equal(memory.ramBusEnd(), end, 'the hardware reset does not infer a new aperture from the program image');
	const depth = cpu.getFrameDepth();
	commands.push('P');
	expected.push(`${depth} ${cpu.readFramePc(depth - 1)}`);
	const trace = join(directory, 'masked-reset.trace'), rom = join(directory, 'masked-reset.rom');
	writeFileSync(trace, commands.join('\n'));
	writeFileSync(rom, system.romBytes);
	assert.deepEqual(execFileSync(native, [rom, trace, trace], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	console.log('BIOS-EXEC-RESET-INTERLOCK:PASS (raw ROM, masked pending request, accepted before successor)');
}

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-exec-heap-floor-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	verifyFullArenaTransfer(native, directory);
	verifyMaskedReset(native, directory);
	for (const optLevel of [0, 3] as const) {
		const bios = linkManagedTestSystem(MANAGED_CART_LAUNCH, optLevel);
		const systemRomBytes = writeTestBlua32Rom(bios);
		const entry = bios.symbols.functionAddresses[bios.symbols.metadata.functionIds.indexOf('module:main/entry')];
		assert.ok(entry, 'the linked launcher has a main entry');
		const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource), [], { entrySource: cartSource, optLevel });
		const pair = linkTestCartBlua32(bios.biosImports, cart);
		const otherSource = cartSource.replace('0x10000', '0x8000');
		const other = compileLuaChunkToProgram(parseLuaChunk(otherSource), [], { entrySource: otherSource, optLevel });
		const otherPair = linkTestCartBlua32(bios.biosImports, other);
		const biosPath = join(directory, `system-O${optLevel}.rom`), cartPath = join(directory, `cart-O${optLevel}.rom`);
		const otherPath = join(directory, `nonselected-O${optLevel}.rom`);
		writeFileSync(biosPath, systemRomBytes);
		writeFileSync(cartPath, pair.cartRomBytes);
		writeFileSync(otherPath, otherPair.cartRomBytes);
		for (const scenario of ['admission', 'refused', 'reclaimed'] as const) {
			const runtime = new Runtime({
				systemRomBytes: systemRomBytes, cartridgeSlots: cartridgeSlots(otherPair.cartRomBytes, pair.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			}, {
				sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
			});
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator } = nativeHeapReference(cpu);
			memory.writeMappedWord(IO_CART_SELECT, 1);
			const management = heapAllocator.managementOffset();
			const allocatorState = heapAllocator.allocatorStateOffset(), arena = bindReferenceDlmalloc(memory, allocatorState);
			const control = management + HEAP_GC_CONTROL_OFFSET;
			const traceLimit = management + GC_TRACE_CONTEXT_OFFSET + GcTraceContextField.Limit;
			const parked = () => cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_SYSCALL
				&& cpu.readThreadFrameWord(cpu.rootThread.address, cpu.rootThread.frameDepth - 1, FrameField.Function) === entry;
			for (let i = 0; i < 262144 && !parked(); ++i) {
				assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			}
			assert.ok(parked(), `launcher did not issue the floor request: cause ${cpu.readCauseWord()} EPC ${cpu.readEpcWord()} root ${cpu.rootThread.address}, entry ${entry}`);
			const oldFloor = memory.ramBusEnd(), owner = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
			const caller = cpu.rootThread.frameDepth - 1;
			const successor = cpu.readThreadFrameWord(owner, caller, FrameField.Pc);
			assert.equal(cpu.readEpcWord(), successor);
			assert.equal(decodeBlua32InstructionAtPc(bios.layout.textBytes, bios.layout.header.textAddress, successor - INSTRUCTION_BYTES).op, OpCode.SVC);
			const bss = pair.cartImage.header.bssAddress;
			const floor = RAM_BASE + heapAllocator.floorOffset(bss + pair.cartImage.header.bssByteCount);
			assert.ok(floor > oldFloor);

			let dead = 0, deadText = '';
			nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
			if (scenario === 'refused') {
				// This non-object backing is not on the collector inventory.
				const backing = heapAllocator.allocate(0x380000, true);
				assert.ok(backing >= oldFloor && backing < floor);
				deadText = 'floor refusal must still collect unrooted language storage';
				dead = nativeHeapReference(cpu).stringPool.intern(deadText);
			} else if (scenario === 'reclaimed') {
				deadText = 'T'.repeat(0x380000);
				dead = nativeHeapReference(cpu).stringPool.intern(deadText);
				assert.ok(dead >= oldFloor && dead < floor);
				// This earlier transient root lets the current epoch retain the
				// physical obstacle; only the subsequent fresh epoch can free it.
				gc.step(valueString(dead), valueNil(), valueNil(), 0, false, 1);
				assert.equal(gc.phase(), GcPhase.Mark);
			}
			if (scenario !== 'admission') {
				assert.equal(arena.setFloor(floor - RAM_BASE), 0, 'the original allocator refuses this exact floor before EXEC');
				assert.equal(arena.floor(), oldFloor - RAM_BASE);
			}
			memory.writeRamRecordWord(bss, sentinel);

			const label = `O${optLevel}-${scenario}`;
			const seedPath = join(directory, `${label}.seed`), partialPath = join(directory, `${label}.partial`);
			const nativePath = join(directory, `${label}.native`);
			writeFileSync(seedPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const trace: string[] = [], expected: string[] = [];
			function observe(command: string, result: string | number) {
				trace.push(command);
				expected.push(String(result));
			}
			function observeRam(first: number, end: number) {
				observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
			}
			function step(cycles: number) {
				const held = cpu.fixedInterruptActive();
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				const consumed = cycles - cpu.instructionBudgetRemaining;
				// One admitted instruction can cross the grant, not a host GC cycle charge.
				if (held) assert.ok(consumed > 0 && consumed < cycles + maxInstructionCycles, `EXEC uses ordinary BIOS grants: paid ${consumed}/${cycles}`);
				observe(`E ${cycles}`, `${result} ${consumed} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
				return result;
			}
			assert.equal(gc.phase(), scenario === 'reclaimed' ? GcPhase.Mark : GcPhase.Pause, 'SVC entry does not run the collector');
			function assertHeld() {
				assert.ok(parked(), 'floor recovery remains within the architectural exception');
				assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), successor);
				assert.equal(memory.ramBusEnd(), oldFloor, 'do not publish the floor before the activation returns');
				assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
				assert.equal(memory.readRamRecordWord(bss), sentinel, 'target BSS is untouched during floor service');
			}
			assertHeld();
			if (scenario === 'admission') {
				for (let i = 0; i < 1024 && arena.floor() !== floor - RAM_BASE; ++i) {
					assertHeld();
					assert.equal(step(1), RunResult.Yielded);
				}
				assert.equal(arena.floor(), floor - RAM_BASE, 'firmware writes the new floor before the bus publishes it');
			} else {
				for (let i = 0; i < 32768 && gc.phase() !== GcPhase.Sweep; ++i) {
					assertHeld();
					assert.equal(step(11), RunResult.Yielded);
				}
				assert.equal(gc.phase(), GcPhase.Sweep, 'checkpoint inside actual dispatched collection, not its caller');
				assert.equal(arena.floor(), oldFloor - RAM_BASE, 'refusal leaves the arena floor unchanged');
				assert.equal(memory.readRamRecordWord(traceLimit), 4096, 'tiny host grants do not replace the source work allowance');
				assert.equal(nativeHeapReference(cpu).stringPool.find(deadText), dead);
			}
			assertHeld();
			const checkpoint = captureRuntimeCheckpointState(runtime), partial = history.capture(memory, baseline);
			writeFileSync(partialPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			observeRam(control, CPU_FIXED_FRAME_ADDRESS - RAM_BASE + FRAME_CONTROL_BYTES);
			observeRam(CPU_INTERRUPTED_CONTEXT_ADDRESS - RAM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS - RAM_BASE + 4);
			observe('Z', `${CPU_CAUSE_CODE_SYSCALL} 0 ${successor}`);
			const traceStart = trace.length, expectedStart = expected.length;

			function finishTransfer() {
				let epochs = 0, phase = gc.phase();
				for (let i = 0; i < 32768 && cpu.fixedInterruptActive(); ++i) {
					assertHeld();
					// Observe Pause at the end of each real String sweep before
					// the next step can start the next epoch of the same call.
					step(phase === GcPhase.Strings || phase === GcPhase.Pause ? 1 : 11);
					const next = gc.phase();
					if (phase === GcPhase.Strings && next === GcPhase.Pause) {
						++epochs;
						const survivor = scenario === 'reclaimed' && epochs === 1;
						assert.equal(nativeHeapReference(cpu).stringPool.find(deadText), survivor ? dead : undefined);
						observeRam(control, allocatorState);
					}
					phase = next;
				}
				assert.equal(cpu.fixedInterruptActive(), false);
				assert.equal(gc.phase(), GcPhase.Pause);
				assert.equal(epochs, scenario === 'admission' ? 0 : scenario === 'reclaimed' ? 2 : 1);
				assert.equal(memory.readRamRecordWord(bss), sentinel, 'even successful commit has not executed target instructions');
				observeRam(oldFloor - RAM_BASE, memory.ramByteCount());
				if (scenario === 'refused') {
					for (let i = 0; i < 64 && !cpu.isHaltedUntilIrq(); ++i) step(1);
					assert.equal(cpu.isHaltedUntilIrq(), true, 'the firmware handles a refused floor');
					assert.equal(memory.ramBusEnd(), oldFloor);
					assert.equal(arena.floor(), oldFloor - RAM_BASE);
					assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
				} else {
					assert.equal(memory.ramBusEnd(), oldFloor, 'the floor operation does not change the machine aperture');
					let atExec = false;
					for (let i = 0; i < 32768 && !atExec; ++i) {
						if (!cpu.fixedInterruptActive()) {
							const instruction = decodeBlua32InstructionAtPc(bios.layout.textBytes, bios.layout.header.textAddress,
								cpu.readFramePc(cpu.getFrameDepth() - 1));
							atExec = instruction.op === OpCode.MTC0 && instruction.b === COP0_EXEC;
						}
						if (!atExec) assert.equal(step(1), RunResult.Yielded);
					}
					assert.ok(atExec, 'the authenticated launcher finished binding operands before issuing EXEC');
					assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
					assert.equal(memory.ramBusEnd(), floor, 'the preceding explicit CP0 RAM_END publishes the aperture');
					assert.equal(arena.floor(), floor - RAM_BASE);
					assert.equal(step(1), RunResult.Yielded);
					assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.MTC0]);
					assert.equal(cpu.activeCartridgeSlot(), 1);
					const entry = cpu.rootThread.frameAtDepth(0);
					assert.equal(cpu.getFrameDepth(), 1);
					assert.equal(entry.functionAddress, pair.cartVectors.startupFunctionAddress);
					assert.equal(entry.closureAddress, 0);
					assert.equal(entry.top, 0);
					assert.equal(entry.isExceptionFrame, false);
					observe('P', `1 ${entry.pc}`);
					observeRam(entry.controlOffset, entry.controlOffset + FRAME_CONTROL_BYTES);
					let result = RunResult.Yielded;
					for (let i = 0; i < 64 && result === RunResult.Yielded; ++i) result = step(65536);
					assert.equal(result, RunResult.Halted);
					assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
					assert.equal(memory.readRamRecordWord(bss), 37);
					observe('C', 37);
					observeRam(bss - RAM_BASE, bss - RAM_BASE + 4);
				}
			}
			finishTransfer();
			const tail = trace.slice(traceStart), rows = expected.slice(expectedStart);
			function checkNative(sample: string, snapshot: string, commands: string[], outputs: string[]) {
				const path = join(directory, `${label}-${sample}.trace`);
				writeFileSync(path, commands.join('\n'));
				const result = execFileSync(native, [biosPath, path, snapshot, otherPath, cartPath], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = result.findIndex((line, i) => line !== outputs[i]);
				assert.equal(mismatch, -1, `${sample} first differing observation ${mismatch}: native=${result[mismatch]}, TS=${outputs[mismatch]}`);
				assert.equal(result.length, outputs.length, 'native observation count');
			}
			checkNative('cold', seedPath, ['X', ...trace.slice(0, traceStart), `x ${nativePath}`], expected.slice(0, expectedStart));
			checkNative('resume', partialPath, ['X', 'l', 's', ...tail, 'u', ...tail], [...rows, ...rows]);

			function replay() {
				trace.length = traceStart;
				expected.length = expectedStart;
				finishTransfer();
				assert.deepEqual(trace.slice(traceStart), tail);
				assert.deepEqual(expected.slice(expectedStart), rows);
			}
			history.restore(memory, history.capture(memory, partial), partial);
			applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			replay();
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			replay();
			console.log(`BIOS-EXEC-HEAP-FLOOR:PASS ${label} (${expected.length} exact grant/RAM observations, portable restore and rewind)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
