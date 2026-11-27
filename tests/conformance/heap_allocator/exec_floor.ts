import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { closureRecordBytes } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger, valueNil, valueString } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { COP0_EXEC } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import {
	HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_EXEC_PENDING_OFFSET, HEAP_SERVICE_FRAME_OFFSET,
	HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HeapServiceOperation, HeapServiceTraceField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_CART_SELECT } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkRawTestSystemBlua32, linkTestBlua32Pair } from '../../helpers/blua32';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const biosSource = `cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
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
	const { cpu, scheduler, memory } = runtime.machine, arena = cpu.heapAllocator;
	const minimum = closureRecordBytes(0, false);
	for (let bytes = arena.unoccupiedBytes(); bytes >= minimum; bytes >>>= 1) {
		while (arena.allocate(bytes, true) !== 0) { /* Reserved backing, not reclaimable objects. */ }
	}
	while (arena.allocate(minimum, true) !== 0) { /* Exhaust every block that could hold a Closure. */ }
	const occupied = arena.occupiedBytes(), charged = cpu.luaHeap.usedBytes();
	const seed = join(directory, 'full-arena.state'), trace = join(directory, 'full-arena.trace'), rom = join(directory, 'full-arena.rom');
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands = ['X'], expected: string[] = [];
	function grant(cycles: number, expectedResult: RunResult, paid: number) {
		assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), expectedResult);
		assert.equal(cycles - cpu.instructionBudgetRemaining, paid);
		assert.equal(arena.occupiedBytes(), occupied);
		assert.equal(cpu.luaHeap.usedBytes(), charged);
		commands.push(`J ${cycles} 1`);
		expected.push(`${expectedResult} ${paid} 0 0 ${occupied} ${charged}`);
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


mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-exec-heap-floor-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	verifyFullArenaTransfer(native, directory);
	for (const optLevel of [0, 3] as const) {
		const bios = compileHeapServiceSystem(biosSource, optLevel);
		const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource), [], { entrySource: cartSource, optLevel });
		const pair = linkTestBlua32Pair(bios, cart);
		const otherCartSource = cartSource.replace('37', '73');
		const otherCart = compileLuaChunkToProgram(parseLuaChunk(otherCartSource), [], { entrySource: otherCartSource, optLevel });
		const otherPair = linkTestBlua32Pair(bios, otherCart);
		assert.equal(pair.cartVectors.startupFunctionAddress, otherPair.cartVectors.startupFunctionAddress);
		assert.ok(pair.systemImage.header.flags & HEAP_SERVICE_IMAGE_FLAG, 'the System linker publishes the actual allocator roster');
		const descriptor = readLE32(pair.systemRomBytes, pair.systemImage.address + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
		const floorEntry = readLE32(pair.systemRomBytes, descriptor + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * HeapServiceOperation.SetFloor);
		const biosPath = join(directory, `system-O${optLevel}.rom`), cartPath = join(directory, `cart-O${optLevel}.rom`);
		const otherCartPath = join(directory, `other-O${optLevel}.rom`);
		writeFileSync(biosPath, pair.systemRomBytes);
		writeFileSync(cartPath, pair.cartRomBytes);
		writeFileSync(otherCartPath, otherPair.cartRomBytes);
		for (const scenario of ['admission', 'refused', 'reclaimed'] as const) {
			const runtime = new Runtime({
				systemRomBytes: pair.systemRomBytes, cartridgeSlots: cartridgeSlots(pair.cartRomBytes, otherPair.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			}, {
				sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
			});
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator } = cpu;
			// Place the pressure fixture at the issuing instruction. The ordinary
			// startup CALLs preceding EXEC may legitimately assist collection.
			let atExec = false;
			for (let i = 0; i < 8192; ++i) {
				if (!cpu.heapServiceActive()) {
					const instruction = decodeBlua32InstructionAtPc(pair.systemImage.textBytes, pair.systemImage.header.textAddress,
						cpu.readFramePc(cpu.getFrameDepth() - 1));
					if (instruction.op === OpCode.MTC0 && instruction.b === COP0_EXEC) { atExec = true; break; }
				}
				assert.equal(scheduler.runCpuSlice(0, cpu.heapServiceActive() ? 123 : 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			}
			assert.ok(atExec, 'the reset program reached its real EXEC instruction');
			const management = heapAllocator.managementOffset(), oldFloor = memory.ramBusEnd();
			const allocatorState = heapAllocator.allocatorStateOffset(), arena = memory.bindDlmalloc(allocatorState);
			const pendingAddress = management + HEAP_SERVICE_EXEC_PENDING_OFFSET;
			const pin = management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
			const control = management + HEAP_GC_CONTROL_OFFSET;
			const traceLimit = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET + HeapServiceTraceField.Limit;
			const pending = () => memory.readRamRecordWord(pendingAddress);
			const bss = pair.cartImage.header.bssAddress;
			const floor = RAM_BASE + heapAllocator.floorOffset(bss + pair.cartImage.header.bssByteCount);
			assert.ok(floor > oldFloor);

			let dead = 0, deadText = '';
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			if (scenario === 'refused') {
				// This non-object backing is not on the collector inventory.
				const backing = heapAllocator.allocate(0x380000, true);
				assert.ok(backing >= oldFloor && backing < floor);
				deadText = 'floor refusal must still collect unrooted language storage';
				dead = cpu.stringPool.intern(deadText);
			} else if (scenario === 'reclaimed') {
				deadText = 'T'.repeat(0x380000);
				dead = cpu.stringPool.intern(deadText);
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
				const held = pending() !== 0;
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				const consumed = cycles - cpu.instructionBudgetRemaining;
				// One admitted instruction can cross the grant, not a host GC cycle charge.
				if (held) assert.ok(consumed > 0 && consumed < cycles + maxInstructionCycles, `EXEC uses ordinary BIOS grants: paid ${consumed}/${cycles}`);
				observe(`E ${cycles}`, `${result} ${consumed} ${+cpu.heapServiceActive()} ${pending()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
				return result;
			}
			for (let i = 0; i < 8192 && pending() === 0; ++i) assert.notEqual(step(1), RunResult.Halted);
			assert.equal(pending(), 1, 'guest EXEC enters the linked firmware');
			assert.equal(gc.phase(), scenario === 'reclaimed' ? GcPhase.Mark : GcPhase.Pause, 'issuing EXEC does not run the collector');
			const caller = cpu.getFrameDepth() - 1, successor = cpu.readFramePc(caller);
			function assertHeld() {
				assert.equal(pending(), 1);
				assert.equal(cpu.heapServiceActive(), true);
				assert.equal(memory.readRamRecordWord(pin), floorEntry, 'floor recovery remains within its one linked activation');
				assert.equal(cpu.readFramePc(caller), successor);
				assert.equal(memory.ramBusEnd(), oldFloor, 'do not publish the floor before the activation returns');
				assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
				assert.equal(memory.readRamRecordWord(bss), sentinel, 'target BSS is untouched during floor service');
			}
			assertHeld();
			// Physical select can change while EXEC is parked; its original
			// cartridge is still the only target the committed transfer can run.
			memory.writeMappedWord(IO_CART_SELECT, 1);
			trace.push(`O ${IO_CART_SELECT} 1`);
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
				assert.equal(cpu.stringPool.find(deadText), dead);
			}
			assertHeld();
			const checkpoint = captureRuntimeCheckpointState(runtime), partial = history.capture(memory, baseline);
			writeFileSync(partialPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			observeRam(control, management + HEAP_SERVICE_FRAME_OFFSET + FRAME_CONTROL_BYTES);
			observe('P', `${caller + 1} ${successor}`);
			const traceStart = trace.length, expectedStart = expected.length;
			cpu.requestNonMaskableInterrupt();
			assert.equal(cpu.enterPendingInterrupt(), false, 'NMI cannot enter during floor reservation/collection');
			cpu.cancelNonMaskableInterrupt();

			function finishTransfer() {
				let epochs = 0, phase = gc.phase();
				for (let i = 0; i < 32768 && cpu.heapServiceActive(); ++i) {
					assertHeld();
					// Observe Pause at the end of each real String sweep before
					// the next step can start the next epoch of the same call.
					step(phase === GcPhase.Strings ? 1 : 11);
					const next = gc.phase();
					if (phase === GcPhase.Strings && next === GcPhase.Pause) {
						++epochs;
						const survivor = scenario === 'reclaimed' && epochs === 1;
						assert.equal(cpu.stringPool.find(deadText), survivor ? dead : undefined);
						observeRam(control, allocatorState);
					}
					phase = next;
				}
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(pending(), 0);
				assert.equal(gc.phase(), GcPhase.Pause);
				assert.equal(epochs, scenario === 'admission' ? 0 : scenario === 'reclaimed' ? 2 : 1);
				assert.equal(memory.readRamRecordWord(bss), sentinel, 'even successful commit has not executed target instructions');
				observeRam(oldFloor - RAM_BASE, memory.ramByteCount());
				const halted = cpu.captureRuntimeState().hardHalted;
				assert.equal(halted, scenario === 'refused');
				observe('F', +halted);
				if (scenario === 'refused') {
					assert.equal(memory.ramBusEnd(), oldFloor);
					assert.equal(arena.floor(), oldFloor - RAM_BASE);
					assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
				} else {
					assert.equal(memory.ramBusEnd(), floor);
					assert.equal(arena.floor(), floor - RAM_BASE);
					assert.equal(cpu.activeCartridgeSlot(), 0);
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
				const result = execFileSync(native, [biosPath, path, snapshot, cartPath, otherCartPath], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = result.findIndex((line, i) => line !== outputs[i]);
				assert.equal(mismatch, -1, `${sample} first differing observation ${mismatch}: native=${result[mismatch]}, TS=${outputs[mismatch]}`);
				assert.equal(result.length, outputs.length, 'native observation count');
			}
			checkNative('cold', seedPath, ['X', ...trace.slice(0, traceStart), `x ${nativePath}`, 'N', 'I'], [...expected.slice(0, expectedStart), '0']);
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
