import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AllocationRecovery, CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { LuaAllocationMode } from '../../../machine/ts/machine/cpu/lua_heap';
import { TableHeader, TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ValueTag, valueInteger, valueNil, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { advanceRuntimeTime } from '../../../machine/ts/machine/runtime/cpu_executor';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { LogicalTickResult } from '../../../machine/ts/machine/scheduler/frame';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_STRING_RECORD_KIND } from '../../../machine/ts/spec/blua32/image_format';
import {
	HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_NEWT_OFFSET,
	HeapServiceGcStage, HeapServiceNewtField, HeapServiceNewtStage,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = 'local t = {120, x = 63, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8}\nreturn t[1] + t.x, t';
const runtimeInput = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-newt-heap-service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel));
		assert.ok(system.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
		const romPath = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(romPath, system.romBytes);
		let newtPc = 0;
		for (const scenario of ['direct', 'scheduled', 'oom', 'recovered'] as const) {
			const scheduled = scenario !== 'direct';
			const configuration = {
				systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
			};
			const runtime = new Runtime(configuration, runtimeInput);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			const arena = cpu.heapAllocator, budget = cpu.luaHeap;
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const stageAddress = arena.managementOffset() + HEAP_SERVICE_NEWT_OFFSET;
			const stage = () => memory.readRamRecordWord(stageAddress);
			const trace: string[] = [], expected: string[] = [];
			const observe = (command: string, value: string | number) => {
				trace.push(command);
				expected.push(String(value));
			};
			const step = (cycles: number) => {
				const time = scheduler.nowCycles;
				const result = scheduled ? scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled)
					: runtime.cpuExecution.runSuspendedUntilDepth(0, cycles);
				const elapsed = scheduled ? cycles - cpu.instructionBudgetRemaining : scheduler.nowCycles - time;
				observe(scheduled ? `J ${cycles} 1` : `D ${cycles}`,
					`${result} ${elapsed} ${+cpu.heapServiceActive()} ${stage()} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
				return elapsed;
			};

			let body: () => void;
			trace.push('l');
			const label = `O${optLevel}-${scenario}`;
			const checkpointPath = join(directory, `newt-${label}.state`);
			const nativeCheckpointPath = join(directory, `newt-${label}-native.state`);
			if (scenario === 'oom' || scenario === 'recovered') {
				for (let i = 0; i < 256 && cpu.readFramePc(cpu.getFrameDepth() - 1) !== newtPc; ++i) step(1);
				assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), newtPc);
				const allocate = (bytes: number) => {
					const address = arena.allocate(bytes, true);
					observe(`A ${bytes}`, address);
					return address;
				};
				const free = (address: number) => {
					arena.free(address);
					trace.push(`V ${address}`);
				};
				const recordBytes = TableRecords.HEADER_BYTES + GC_OBJECT_PREFIX;
				const arrayBytes = 5, hashBackingBytes = TableRecords.hashStorageBytes(8);
				const deadString = cpu.stringPool.intern('dead');
				observe('b dead', deadString);
				assert.ok(allocate(32), 'prevent the dead String from coalescing with a reservation slot');
				const longString = 'reclaimed'.repeat(64);
				const discarded = scenario === 'recovered' ? cpu.stringPool.intern(longString) : 0;
				if (scenario === 'recovered') {
					assert.ok(discarded);
					observe(`b ${longString}`, discarded);
				}
				const beforeRecord = arena.occupiedBytes();
				const record = allocate(recordBytes);
				const physicalRecord = arena.occupiedBytes() - beforeRecord;
				assert.ok(record && allocate(32));
				const beforeArray = arena.occupiedBytes();
				const array = allocate(arrayBytes);
				const physicalArray = arena.occupiedBytes() - beforeArray;
				assert.ok(array && allocate(32));
				while (allocate(4088)) {}
				while (allocate(hashBackingBytes)) {}
				free(array);
				free(record);
				if (discarded) {
					// Keep the backing alive for the interrupted epoch only.
					// The first retry must fail; a fresh epoch can reclaim it.
					observe(`y ${discarded}`, cpu.gc.step(valueString(discarded), valueNil(), valueNil(), 0, false, 1));
					assert.ok(cpu.gc.active());
				}

				const physical = arena.occupiedBytes(), logical = budget.usedBytes(), caller = cpu.getFrameDepth() - 1;
				const referenceStart = captureRuntimeSaveState(runtime);
				const charge = TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(1, 8);
				// Retry mode isolates the original WASM-backed reserveRecord path
				// from collector policy. It runs on the exact same arena and request.
				assert.equal(budget.allocateRecord(TableRecords.HEADER_BYTES, true, arrayBytes, TableHeader.ArrayStorage,
					valueNil(), valueNil(), valueNil(), charge, LuaAllocationMode.Retry, hashBackingBytes, TableHeader.HashStorage), 0);
				const state = arena.allocatorStateOffset();
				const refusedArena = hashBytes(memory.ramData(), state, 0x200);
				applyRuntimeSaveState(runtime, referenceStart);
				const frames = runtime.frameScheduler;
				assert.ok(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame));
				const edge = scheduler.nowCycles;
				applyRuntimeSaveState(runtime, referenceStart);
				const wait = edge - scheduler.nowCycles - 96;
				assert.ok(wait > 0);
				advanceRuntimeTime(runtime, wait);
				observe(`v ${wait}`, scheduler.nowCycles);
				step(1);
				assert.equal(stage(), HeapServiceNewtStage.Scheduled);
				const partial = physical + physicalRecord + physicalArray;
				for (let i = 0; i < 2048 && arena.occupiedBytes() < partial; ++i) step(1);
				assert.ok(cpu.heapServiceActive());
				assert.equal(arena.occupiedBytes(), partial, 'both the record and array block are reserved before the hash refusal');
				assert.equal(budget.usedBytes(), logical);
				for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) step(1);
				assert.ok(cpu.allocationParked());
				assert.equal(arena.occupiedBytes(), physical, 'refused hash returns both partial reservations');
				assert.equal(budget.usedBytes(), logical);
				observe(`H ${state} ${state + 0x200}`, refusedArena);
				assert.equal(hashBytes(memory.ramData(), state, 0x200), refusedArena, 'allocation bookkeeping equals the WASM reference');
				assert.equal(cpu.readFramePc(caller), newtPc);
				const pressure = () => memory.readRamRecordWord(arena.managementOffset() + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET);
				const schedulerStep = (step: 'a' | 'd') => {
					const op = step === 'd' && cpu.gc.serviceStage() === HeapServiceGcStage.MaintenanceTrace ? 'k' : step;
					const before = frames.lastTickSequence;
					const cycle = scheduler.nowCycles;
					const result = op === 'a' ? frames.advanceLogicalTick(0) : frames.stepInstruction(1);
					if (op === 'k') {
						// Native trace mirrors check issuance and color in different
						// order. Compare at retirement, including the device edge,
						// while retaining single-instruction timing elsewhere.
						for (let grant = 1; cpu.gc.serviceStage() === HeapServiceGcStage.MaintenanceTrace && grant < 65536; ++grant)
							frames.stepInstruction(1);
						assert.notEqual(cpu.gc.serviceStage(), HeapServiceGcStage.MaintenanceTrace);
						assert.ok(scheduler.nowCycles > cycle);
					}
					observe(op, `${result} ${op === 'k' ? 1 : scheduler.nowCycles - cycle} ${+(frames.lastTickSequence !== before)} ${+cpu.allocationParked()} ${+cpu.allocationReady()} ${+cpu.heapServiceActive()} ${cpu.gc.serviceStage()} ${stage()} ${pressure()} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
					return result;
				};
				for (let i = 0; i < 128 && !cpu.heapServiceActive(); ++i) {
					const result = schedulerStep('a');
					assert.equal(result, cpu.heapServiceActive() ? LogicalTickResult.Incomplete : LogicalTickResult.Maintenance);
					assert.equal(scheduler.nowCycles, edge - 96, 'only the remaining native prefix is stopped');
				}
				assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.MaintenanceTrace);
				assert.equal(memory.readRamRecordByte(deadString), BLUA32_STRING_RECORD_KIND);
				const recoverySlice = () => {
					const before = scheduler.nowCycles;
					const result = schedulerStep('d');
					if (result === InstructionStepResult.Blocked) {
						assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.Idle);
						assert.equal(scheduler.nowCycles, before, 'a native maintenance boundary does not consume device time');
					} else {
						assert.equal(result, InstructionStepResult.Advanced);
						assert.ok(scheduler.nowCycles > before, 'firmware advances device time');
					}
					assert.ok(cpu.allocationParked());
					assert.equal(cpu.readFramePc(caller), newtPc);
				};
				let recoveryStages = 0;
				let partialLogicalBytes = 0;
				for (let i = 0; i < 65536 && memory.readRamRecordByte(deadString) !== 0; ++i) {
					partialLogicalBytes = budget.usedBytes();
					recoveryStages |= 1 << cpu.gc.serviceStage();
					recoverySlice();
					assert.equal(cpu.allocationReady(), false);
				}
				for (const entered of [HeapServiceGcStage.MaintenanceTrace, HeapServiceGcStage.MaintenanceWeakClear,
					HeapServiceGcStage.AllocationRecoveryObjectSweep, HeapServiceGcStage.AllocationRecoveryStringSweep]) {
					assert.notEqual(recoveryStages & (1 << entered), 0, `allocation recovery enters BIOS stage ${entered}`);
				}
				assert.equal(memory.readRamRecordByte(deadString), 0, 'checkpoint after unlinking but before charging the reclaimed String');
				assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
				assert.equal(budget.usedBytes(), partialLogicalBytes);
				assert.equal(frames.lastTickSequence, 1, 'physical VBlank runs during parked BIOS reclamation');
				assert.ok(scheduler.nowCycles >= edge);
				assert.equal(pressure(), 1);
				const checkpointCycles = scheduler.nowCycles;
				const finishSweep = () => {
					for (let i = 0; i < 65536 && !cpu.allocationReady(); ++i) {
						recoverySlice();
						assert.equal(pressure(), 1, 'the edge cannot admit an extra GC assist ahead of the retry');
					}
					assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.Idle);
					assert.ok(cpu.allocationReady());
					assert.ok(scheduler.nowCycles > checkpointCycles);
					assert.equal(cpu.readFramePc(caller), newtPc);
				};
				const tryReservation = (expectedStage: HeapServiceNewtStage) => {
					schedulerStep('d');
					assert.equal(stage(), expectedStage);
					for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) schedulerStep('d');
					assert.equal(stage(), HeapServiceNewtStage.Idle);
				};
				body = () => {
					finishSweep();
					assert.equal(cpu.stringPool.find('dead'), undefined);
					if (discarded) {
						assert.equal(cpu.stringPool.find(longString), discarded);
						tryReservation(HeapServiceNewtStage.RetryCurrent);
						assert.equal(cpu.captureRuntimeState().pendingAllocation?.recovery, AllocationRecovery.Fresh);
						finishSweep();
						assert.equal(cpu.stringPool.find(longString), undefined);
					}
					tryReservation(HeapServiceNewtStage.RetryFresh);
					assert.equal(cpu.allocationParked(), false);
					if (scenario === 'oom') {
						assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
						assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP);
						assert.equal(cpu.readEpcWord(), newtPc);
						observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
					} else {
						assert.ok(cpu.readFramePc(caller) > newtPc);
						assert.ok(arena.occupiedBytes() < physical, 'collecting the dead String freed room for the hash');
						for (let i = 0; i < 1024 && cpu.getFrameDepth() !== 0; ++i) schedulerStep('d');
						assert.equal(cpu.getFrameDepth(), 0);
						assert.equal(runtime.readCompletionValues()[0], valueInteger(183));
						assert.equal(pressure(), 0, 'deferred pressure is served after the request retires');
						observe('C', 183);
					}
					observe(`H ${state} ${state + 0x200}`, hashBytes(memory.ramData(), state, 0x200));
				};
			} else {
				for (let i = 0; i < 256 && !cpu.heapServiceActive(); ++i) step(1);
				assert.ok(cpu.heapServiceActive(), 'executing NEWT enters actual System BIOS instructions');
				assert.equal(stage(), scheduled ? HeapServiceNewtStage.Scheduled : HeapServiceNewtStage.Direct);
				const before = arena.occupiedBytes(), logical = budget.usedBytes();
				const caller = cpu.getFrameDepth() - 1;
				const issuePc = cpu.readFramePc(caller);
				const destination = memory.readRamRecordWord(stageAddress + HeapServiceNewtField.Destination);
				const parkedValue = cpu.readFrameRegister(caller, destination);
				const arrayCount = memory.readRamRecordWord(stageAddress + HeapServiceNewtField.ArraySize);
				const hashRequest = memory.readRamRecordWord(stageAddress + HeapServiceNewtField.HashSize);
				const oracle = new Runtime(configuration, runtimeInput);
				oracle.boot();
				applyRuntimeSaveState(oracle, captureRuntimeSaveState(runtime));
				const record = oracle.machine.cpu['allocateTable'](arrayCount, hashRequest, LuaAllocationMode.Retry);
				const oracleMemory = oracle.machine.memory;
				const array = oracleMemory.readRamRecordWord(record + TableHeader.ArrayStorage);
				const hash = oracleMemory.readRamRecordWord(record + TableHeader.HashStorage);
				const hashExtent = TableRecords.hashStorageBytes(TableRecords.hashCapacity(hashRequest));
				assert.ok(record && array && hash);
				const published = () => {
					let found = false;
					cpu.gc.visitObjectRecords(record, (target, address) => { if (address === target) found = true; });
					return found;
				};
				newtPc = issuePc;
				for (let i = 0; i < 2048 && arena.occupiedBytes() === before; ++i) step(1);
				assert.ok(cpu.heapServiceActive());
				assert.ok(arena.occupiedBytes() > before, 'first physical reservation has mutated the arena');
				assert.equal(budget.usedBytes(), logical, 'compound reservation has not yet committed');
				for (let i = 0; i < 4096 && budget.usedBytes() === logical; ++i) step(1);
				assert.equal(budget.usedBytes(), oracle.machine.cpu.luaHeap.usedBytes());
				assert.equal(memory.readRamRecordWord(record + TableHeader.ArrayStorage), array);
				assert.equal(memory.readRamRecordWord(record + TableHeader.HashStorage), hash);

				// These allocated words stand in for stale backing data. Stop
				// after the array payload is cleared but before the hash starts.
				const stale = 0x39393939;
				for (const address of [array, hash]) {
					memory.writeRamRecordWord(address, stale);
					trace.push(`W ${address} ${stale}`);
				}
				for (let i = 0; i < 4096 && memory.readRamRecordWord(array) !== 0; ++i) step(1);
				assert.equal(memory.readRamRecordWord(array), 0);
				assert.equal(memory.readRamRecordWord(hash), stale);
				assert.ok(cpu.heapServiceActive());
				assert.equal(cpu.readFramePc(caller), issuePc, 'issuing NEWT has not advanced');
				assert.equal(cpu.readFrameRegister(caller, destination), parkedValue);
				assert.equal(published(), false, 'the collector cannot see a half-initialized table');
				const compare = (address: number, bytes: number) => {
					const first = address & RAM_RECORD_WORD_MASK;
					const end = first + bytes;
					assert.equal(Buffer.compare(memory.ramData().subarray(first, end), oracleMemory.ramData().subarray(first, end)), 0);
					observe(`H ${first} ${end}`, hashBytes(oracleMemory.ramData(), first, bytes));
				};
				body = () => {
					let paid = 0;
					for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) paid += step(1);
					assert.ok(paid > 0, 'normal guest grants are consumed to finish initialization');
					assert.equal(cpu.heapServiceActive(), false);
					assert.equal(stage(), HeapServiceNewtStage.Idle);
					assert.ok(budget.usedBytes() > logical);
					assert.ok(cpu.readFramePc(caller) > issuePc, 'NEWT retires before the next guest instruction');
					assert.equal(published(), true);
					compare(record - GC_OBJECT_LINK_BEFORE, TableRecords.HEADER_BYTES + GC_OBJECT_LINK_BEFORE);
					compare(array, arrayCount * 5);
					compare(hash, hashExtent);
					let running = true;
					for (let i = 0; i < 16 && running; ++i) {
						step(65536);
						running = cpu.getFrameDepth() !== 0;
					}
					assert.equal(running, false);
					assert.equal(cpu.captureRuntimeState().hardHalted, false);
					const values = runtime.readCompletionValues();
					assert.equal(values[0], valueInteger(183));
					assert.equal(valueTag(values[1]), ValueTag.Table);
					observe('C', 183);
					const first = memory.ramBusEnd() - RAM_BASE;
					observe(`H ${first} ${memory.ramData().length}`, hashBytes(memory.ramData(), first, memory.ramData().length - first));
				};
			}
			const checkpoint = captureRuntimeSaveState(runtime);
			const checkpointRam = history.capture(memory, baseline);
			writeFileSync(checkpointPath, encodeRuntimeSaveState(checkpoint));
			trace.push('S', 's', `x ${nativeCheckpointPath}`);
			const firstCommand = trace.length, firstResult = expected.length;
			body();
			const continuation = trace.slice(firstCommand), results = expected.slice(firstResult);
			for (const restore of ['u', 'U', 'X']) {
				trace.push(restore);
				if (restore === 'u') {
					const completed = history.capture(memory, checkpointRam);
					history.restore(memory, completed, checkpointRam);
					applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
				} else applyRuntimeSaveState(runtime, checkpoint);
				const command = trace.length, result = expected.length;
				body();
				assert.deepEqual(trace.slice(command), continuation);
				assert.deepEqual(expected.slice(result), results);
			}
			const tracePath = join(directory, `newt-${label}.txt`);
			writeFileSync(tracePath, trace.join('\n'));
			const output = execFileSync(native, [romPath, tracePath, checkpointPath], {
				encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
			}).trimEnd().split('\n');
			assert.equal(output.length, expected.length);
			const mismatch = output.findIndex((line, i) => line !== expected[i]);
			assert.equal(mismatch, -1, `first differing NEWT observation ${mismatch}: native=${output[mismatch]}, TS=${expected[mismatch]}`);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeCheckpointPath),
				PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			const command = trace.length, result = expected.length;
			body();
			assert.deepEqual(trace.slice(command), continuation, 'C++ checkpoint resumes the same command sequence');
			assert.deepEqual(expected.slice(result), results, 'C++ checkpoint resumes the same work and RAM on TS');
			console.log(`BIOS-NEWT-HEAP-SERVICE:PASS ${label} (${output.length} observations, ${scenario === 'oom' || scenario === 'recovered' ? 'mid-reclamation' : 'mid-initialization'} rewind and cross-core restore)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
