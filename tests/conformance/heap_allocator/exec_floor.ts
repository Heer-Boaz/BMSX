import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { HEAP_SERVICE_EXEC_STAGE_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HeapServiceExecStage } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_CART_SELECT } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const biosSource = `cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
const cartSource = 'bss records: word[0x10000]\nrecords[0] = 37\nreturn records[0]';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-exec-heap-floor-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const bios = compileHeapServiceSystem(biosSource, optLevel);
		const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource), [], { entrySource: cartSource, optLevel });
		const pair = linkTestBlua32Pair(bios, cart);
		const otherCartSource = cartSource.replace('37', '73');
		const otherCart = compileLuaChunkToProgram(parseLuaChunk(otherCartSource), [], { entrySource: otherCartSource, optLevel });
		const otherPair = linkTestBlua32Pair(bios, otherCart);
		assert.equal(pair.cartVectors.startupFunctionAddress, otherPair.cartVectors.startupFunctionAddress);
		assert.ok(pair.systemImage.header.flags & HEAP_SERVICE_IMAGE_FLAG, 'the System linker publishes the actual allocator roster');
		const biosPath = join(directory, `system-O${optLevel}.rom`), cartPath = join(directory, `cart-O${optLevel}.rom`);
		const otherCartPath = join(directory, `other-O${optLevel}.rom`);
		writeFileSync(biosPath, pair.systemRomBytes);
		writeFileSync(cartPath, pair.cartRomBytes);
		writeFileSync(otherCartPath, otherPair.cartRomBytes);
		for (const blocked of [false, true]) {
			const runtime = new Runtime({
				systemRomBytes: pair.systemRomBytes, cartridgeSlots: cartridgeSlots(pair.cartRomBytes, otherPair.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			}, {
				sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
			});
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			const stageAddress = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_EXEC_STAGE_OFFSET;
			const oldFloor = memory.ramBusEnd();
			const bss = pair.cartImage.header.bssAddress;
			const floor = RAM_BASE + cpu.heapAllocator.floorOffset(bss + pair.cartImage.header.bssByteCount);
			assert.ok(floor > oldFloor);
			const trace: string[] = [], expected: string[] = [];
			const stage = () => memory.readRamRecordWord(stageAddress);
			const observe = (command: string, result: string | number) => {
				trace.push(command);
				expected.push(String(result));
			};
			function step(cycles = 1) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				const consumed = cycles - cpu.instructionBudgetRemaining;
				observe(`E ${cycles}`, `${result} ${consumed} ${+cpu.heapServiceActive()} ${stage()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
				return result;
			}
			function finishTransfer() {
				let sawRetry = false, cycles = 0;
				for (let i = 0; i < 2048 && cpu.heapServiceActive(); ++i) {
					assert.equal(memory.ramBusEnd(), oldFloor, 'do not publish the floor before BIOS completes');
					assert.equal(memory.readRamRecordWord(bss), 0x5eedaa55, 'target BSS is untouched during floor service');
					sawRetry ||= stage() === HeapServiceExecStage.Retry;
					step();
					cycles += 1 - cpu.instructionBudgetRemaining;
				}
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(stage(), HeapServiceExecStage.Idle);
				assert.ok(cycles > 0);
				assert.equal(sawRetry, blocked);
				if (blocked) {
					assert.ok(cpu.captureRuntimeState().hardHalted);
					observe('F', 1);
					assert.equal(memory.ramBusEnd(), oldFloor);
					assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
				} else {
					assert.equal(memory.ramBusEnd(), floor);
					assert.equal(cpu.activeCartridgeSlot(), 0);
				}
				assert.equal(memory.readRamRecordWord(bss), 0x5eedaa55, 'even successful commit has not executed target instructions yet');
				observe(`H ${bss - RAM_BASE} ${bss - RAM_BASE + 4}`, hashBytes(memory.ramData(), bss - RAM_BASE, 4));
			}

			if (blocked) {
				const backing = cpu.heapAllocator.allocate(0x380000, true);
				assert.ok(backing >= oldFloor && backing < floor, `live backing at 0x${backing.toString(16)} must overlap new static storage`);
				observe('A 3670016', backing);
			}
			memory.writeRamRecordWord(bss, 0x5eedaa55);
			trace.push(`W ${bss} ${0x5eedaa55}`);
			// The startup wrapper can reserve a canonical Closure through the
			// same CPU lane. Follow the EXEC latch, not the shared active bit.
			for (let i = 0; i < 8192 && stage() === HeapServiceExecStage.Idle; ++i) {
				assert.notEqual(step(), RunResult.Halted, 'System boot reaches the guest EXEC instruction');
				assert.equal(memory.ramBusEnd(), oldFloor);
				assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
			}
			assert.equal(stage(), HeapServiceExecStage.First, 'guest EXEC must enter private BIOS rather than native set_floor');
			assert.ok(cpu.heapServiceActive());
			// The pending transfer belongs to its original cartridge, even
			// though the same function-record address exists in both sockets.
			memory.writeMappedWord(IO_CART_SELECT, 1);
			trace.push(`O ${IO_CART_SELECT} 1`);
			if (blocked) {
				step(); // the refusing path does not mutate the arena
			} else {
				const allocatorState = cpu.heapAllocator.allocatorStateOffset();
				const arena = memory.bindDlmalloc(allocatorState);
				for (let i = 0; i < 256 && arena.floor() !== floor - RAM_BASE; ++i) step();
				assert.equal(arena.floor(), floor - RAM_BASE, 'the BIOS has written its new floor word');
				assert.equal(memory.ramBusEnd(), oldFloor, 'the bus has not yet published the BIOS result');
				observe(`H ${allocatorState} ${allocatorState + 0x200}`, hashBytes(memory.ramData(), allocatorState, 0x200));
			}
			assert.ok(cpu.heapServiceActive());
			const checkpoint = captureRuntimeSaveState(runtime);
			const checkpointPath = join(directory, `pending-O${optLevel}-${+blocked}.state`);
			writeFileSync(checkpointPath, encodeRuntimeSaveState(checkpoint));
			const start = trace.length, firstResult = expected.length;
			finishTransfer();
			const continuation = trace.slice(start), results = expected.slice(firstResult);
			applyRuntimeSaveState(runtime, checkpoint);
			trace.push('X');
			const replay = trace.length, replayResult = expected.length;
			finishTransfer();
			assert.deepEqual(trace.slice(replay), continuation);
			assert.deepEqual(expected.slice(replayResult), results);
			if (!blocked) {
				let result = RunResult.Yielded;
				for (let i = 0; i < 64 && result === RunResult.Yielded; ++i) result = step(65536);
				assert.equal(result, RunResult.Halted);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
				assert.equal(memory.readRamRecordWord(bss), 37);
				observe('C', 37);
			}
			const tracePath = join(directory, `exec-O${optLevel}-${+blocked}.txt`);
			writeFileSync(tracePath, trace.join('\n'));
			const output = execFileSync(native, [biosPath, tracePath, checkpointPath, cartPath, otherCartPath], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(output.length, expected.length, 'native observation count');
			const mismatch = output.findIndex((line, i) => line !== expected[i]);
			assert.equal(mismatch, -1, `first differing observation ${mismatch}: native=${output[mismatch]}, TS=${expected[mismatch]}`);
			console.log(`BIOS-EXEC-HEAP-FLOOR:PASS O${optLevel} (${blocked ? 'refusal + retry' : 'admission'}; ${expected.length} observations)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
