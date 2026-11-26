import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AllocationRecovery, CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_PACE_PAID, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_COLLECTION_TARGET_OFFSET, HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { LuaAllocationMode } from '../../../machine/ts/machine/cpu/lua_heap';
import { TableHeader, TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ValueTag, valueInteger, valueNil, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
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
	HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_NEWT_ASSIST_OFFSET, HEAP_SERVICE_NEWT_OFFSET,
	HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HeapServiceGcStage, HeapServiceNewtAssistField, HeapServiceNewtField,
	HeapServiceNewtStage, HeapServiceTraceField,
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
		for (const scenario of ['direct', 'scheduled', 'oom', 'recovered', 'direct-oom'] as const) {
			const directOom = scenario === 'direct-oom';
			const scheduled = scenario !== 'direct' && !directOom;
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
			let directRecoveryOutput = -1;
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
			if (scenario === 'oom' || scenario === 'recovered' || directOom) {
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
				let edge = scheduler.nowCycles;
				if (scheduled) {
					assert.ok(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame));
					edge = scheduler.nowCycles;
					applyRuntimeSaveState(runtime, referenceStart);
					const wait = edge - scheduler.nowCycles - 96;
					assert.ok(wait > 0);
					advanceRuntimeTime(runtime, wait);
					observe(`v ${wait}`, scheduler.nowCycles);
				}
				step(1);
				const reservation = scheduled ? HeapServiceNewtStage.Scheduled : HeapServiceNewtStage.Direct;
				assert.equal(stage(), reservation);
				const partial = physical + physicalRecord + physicalArray;
				for (let i = 0; i < 2048 && arena.occupiedBytes() < partial; ++i) step(1);
				assert.ok(cpu.heapServiceActive());
				assert.equal(arena.occupiedBytes(), partial, 'both the record and array block are reserved before the hash refusal');
				assert.equal(budget.usedBytes(), logical);
				for (let i = 0; i < 4096 && stage() === reservation; ++i) step(1);
				assert.equal(cpu.allocationParked(), scheduled);
				assert.equal(arena.occupiedBytes(), physical, 'refused hash returns both partial reservations');
				assert.equal(budget.usedBytes(), logical);
				observe(`H ${state} ${state + 0x200}`, refusedArena);
				assert.equal(hashBytes(memory.ramData(), state, 0x200), refusedArena, 'allocation bookkeeping equals the WASM reference');
				assert.equal(cpu.readFramePc(caller), newtPc);
				if (directOom) {
					assert.ok(cpu.heapServiceActive());
					assert.equal(stage(), HeapServiceNewtStage.DirectRecovery);
					assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.MaintenanceRootHead);
					assert.equal(cpu.captureRuntimeState().pendingAllocation, null);
					assert.equal(cpu.readLuaFaultReasonWord(), 0);
					const guard = new Runtime(configuration, runtimeInput);
					guard.boot();
					applyRuntimeSaveState(guard, captureRuntimeSaveState(runtime));
					guard.machine.cpu.requestNonMaskableInterrupt();
					assert.equal(guard.machine.cpu.enterPendingInterrupt(), false, 'the Direct continuation alone excludes NMI');
					trace.push('S', 'N'); observe('I', 0); trace.push('U');
					const runDirectTo = (stop: HeapServiceNewtStage) => {
						const before = scheduler.nowCycles;
						let visited = 0;
						for (let grant = 0; grant < 65536; ++grant) {
							assert.equal(cpu.readFramePc(caller), newtPc);
							assert.equal(cpu.allocationParked(), false);
							assert.ok(cpu.heapServiceActive());
							visited |= 1 << cpu.gc.serviceStage();
							const result = runtime.cpuExecution.runSuspendedUntilDepth(0, 1);
							if (stage() !== stop) continue;
							const elapsed = scheduler.nowCycles - before;
							assert.ok(elapsed > 0);
							observe(`q ${stop} 65536`, `${result} ${elapsed} ${+cpu.heapServiceActive()} ${stage()} ${arena.occupiedBytes()} ${budget.usedBytes()} ${visited}`);
							return visited;
						}
						assert.fail(`Direct NEWT did not reach stage ${stop}`);
					};
					directRecoveryOutput = expected.length;
					const recovered = runDirectTo(HeapServiceNewtStage.Direct);
					const stages = [HeapServiceGcStage.MaintenanceRootHead, HeapServiceGcStage.MaintenanceRootBanks,
						HeapServiceGcStage.MaintenanceTrace, HeapServiceGcStage.MaintenanceRemark, HeapServiceGcStage.MaintenanceWeakClear,
						HeapServiceGcStage.AllocationRecoveryObjectSweep, HeapServiceGcStage.AllocationRecoveryStringSweep];
					assert.equal(recovered, stages.reduce((mask, entered) => mask | (1 << entered), 0));
					assert.ok(cpu.heapServiceActive());
					assert.equal(cpu.readFramePc(caller), newtPc);
					assert.equal(cpu.readLuaFaultReasonWord(), 0);
					assert.equal(cpu.stringPool.find('dead'), undefined, 'Direct ran reclamation before retrying');
					body = () => {
						assert.equal(stage(), HeapServiceNewtStage.Direct);
						assert.equal(runDirectTo(HeapServiceNewtStage.Idle), 1 << HeapServiceGcStage.Idle, 'the fresh epoch is not repeated');
						assert.equal(cpu.heapServiceActive(), false);
						assert.equal(cpu.captureRuntimeState().pendingAllocation, null);
						assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.Idle);
						assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
						assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP);
						assert.equal(cpu.readEpcWord(), newtPc);
						observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
						observe(`H ${state} ${state + 0x200}`, hashBytes(memory.ramData(), state, 0x200));
					};
				} else {
					const pressure = () => memory.readRamRecordWord(arena.managementOffset() + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET);
					const schedulerStep = (step: 'a' | 'd') => {
						const admitted = cpu.gc.serviceStage();
						const mark = admitted === HeapServiceGcStage.MaintenanceTrace || admitted === HeapServiceGcStage.MaintenanceRemark
							|| admitted === HeapServiceGcStage.MaintenanceRootHead || admitted === HeapServiceGcStage.MaintenanceRootBanks;
						const op = step === 'd' && mark ? 'k' : step;
						const before = frames.lastTickSequence;
						const cycle = scheduler.nowCycles;
						const result = op === 'a' ? frames.advanceLogicalTick(0) : frames.stepInstruction(1);
						if (op === 'k') {
							// The mark and root visitors keep the native mirrors'
							// different admission, color and fixed-root paths.
							// Keep precise device-edge and subsequent timing checks.
							for (let grant = 1; cpu.gc.serviceStage() === admitted && grant < 65536; ++grant)
								frames.stepInstruction(1);
							assert.notEqual(cpu.gc.serviceStage(), admitted);
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
					// The interrupted-epoch fixture already admitted native
					// roots before parking, unlike the fresh OOM epoch.
					assert.equal(cpu.gc.serviceStage(), discarded ? HeapServiceGcStage.MaintenanceRootBanks : HeapServiceGcStage.MaintenanceRootHead);
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
					for (const entered of [HeapServiceGcStage.MaintenanceRootBanks, HeapServiceGcStage.MaintenanceTrace,
						HeapServiceGcStage.MaintenanceRemark, HeapServiceGcStage.MaintenanceWeakClear,
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
				}
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
			if (directOom) {
				// Native mirrors choose different instructions before the retry
				// handoff, but its phase, allocator state and actual retry agree.
				const actual = output[directRecoveryOutput].split(' '), want = expected[directRecoveryOutput].split(' ');
				assert.ok(+actual[1] > 0);
				assert.deepEqual([actual[0], ...actual.slice(2)], [want[0], ...want.slice(2)]);
			}
			const mismatch = output.findIndex((line, i) => i !== directRecoveryOutput && line !== expected[i]);
			assert.equal(mismatch, -1, `first differing NEWT observation ${mismatch}: native=${output[mismatch]}, TS=${expected[mismatch]}`);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeCheckpointPath),
				PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			const command = trace.length, result = expected.length;
			body();
			assert.deepEqual(trace.slice(command), continuation, 'C++ checkpoint resumes the same command sequence');
			assert.deepEqual(expected.slice(result), results, 'C++ checkpoint resumes the same work and RAM on TS');
			console.log(`BIOS-NEWT-HEAP-SERVICE:PASS ${label} (${output.length} observations, ${directOom ? 'Direct-recovery' : scenario === 'oom' || scenario === 'recovered' ? 'mid-reclamation' : 'mid-initialization'} rewind and cross-core restore)`);
		}
		// The guest executes the same NEWT after a real rooted graph has
		// accumulated logical debt and a separate proportional pace debt.
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, runtimeInput), oracle = new Runtime(configuration, runtimeInput);
		runtime.boot();
		oracle.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const { gc, heapAllocator: arena, luaHeap: budget } = cpu;
		for (let i = 0; i < 256 && cpu.readFramePc(cpu.getFrameDepth() - 1) !== newtPc; ++i)
			scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		const caller = cpu.getFrameDepth() - 1;
		assert.equal(cpu.readFramePc(caller), newtPc);
		const atNewt = captureRuntimeSaveState(runtime);
		const retained = cpu.createTable(8192, 0);
		cpu.setGlobalByKey(cpu.stringPool.intern('newt-assist-live-table'), valueTable(retained));
		for (const slot of [1, 33, 257, 513, 1025])
			gc.tables.setInteger(retained, slot, valueString(cpu.stringPool.intern(`newt-assist-young-${slot}`)));
		gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(gc.phase(), GcPhase.Mark);
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const state = arena.allocatorStateOffset(), stageAddress = management + HEAP_SERVICE_NEWT_OFFSET;
		const stage = () => memory.readRamRecordWord(stageAddress + HeapServiceNewtField.Stage);
		const occupied = arena.occupiedBytes(), logical = budget.usedBytes();
		// Preserve the source pacer relation: with unit slope, pay-at is
		// basis + 512 at paid = 0. The first 512 logical words cannot
		// retire the physical growth relative to that basis.
		const basis = occupied - 2048, ratio = 32768;
		const paid = control + GC_PACE_PAID, payAt = paid + 4;
		for (const [address, word] of [[paid - 12, basis], [paid - 8, ratio], [paid - 4, ratio], [paid, 0], [payAt, basis + 512]])
			memory.writeRamRecordWord(address, word);
		budget.setCollectionTarget(logical - 128);
		const seeded = captureRuntimeSaveState(runtime);
		const seedPath = join(directory, `assist-seed-O${optLevel}.state`);
		const checkpointPath = join(directory, `assist-physical-O${optLevel}.state`);
		const nativePath = join(directory, `assist-physical-native-O${optLevel}.state`);
		writeFileSync(seedPath, encodeRuntimeSaveState(seeded));
		applyRuntimeSaveState(oracle, seeded);
		const sourceCpu = oracle.machine.cpu, sourceHeap = sourceCpu.luaHeap, sourceMemory = oracle.machine.memory;
		const charge = TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(1, 8);
		const requested = TableRecords.HEADER_BYTES + GC_OBJECT_PREFIX + 5 + TableRecords.hashStorageBytes(8);
		const epoch = control + GC_LAST_EPOCH_WORK - 4;
		const policy = () => [sourceHeap.collectionTarget(), ...[epoch, paid, payAt].map(offset => sourceMemory.readRamRecordWord(offset))];
		// The ample first guest grant does not clamp either source
		// allowance. The unchanged native policy is the test oracle.
		assert.equal(sourceHeap.prepareAllocation(charge, valueNil(), valueNil(), valueNil()), true);
		const logicalPolicy = policy();
		assert.ok(logicalPolicy[0] > budget.collectionTarget() && logicalPolicy[2] > 0);
		sourceCpu.gc.assistBeforeReservation(requested);
		const physicalPolicy = policy();
		assert.ok(physicalPolicy[2] > logicalPolicy[2] && physicalPolicy[3] > logicalPolicy[3]);
		assert.equal(physicalPolicy[0], logicalPolicy[0], 'physical pace credit does not change the logical collection target');
		const allocator = hashBytes(seeded.ram, state, 0x200);

		type Observation = { command: string; result: string; mirrorClock: boolean };
		const observations: Observation[] = [];
		function observe(command: string, result: string | number, mirrorClock = false) {
			observations.push({ command, result: String(result), mirrorClock });
		}
		const bulk = 65536;
		function grant(cycles: number, mirrorClock = false) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const elapsed = cycles - cpu.instructionBudgetRemaining;
			observe(`J ${cycles} 1`, `${result} ${elapsed} ${+cpu.heapServiceActive()} ${stage()} ${arena.occupiedBytes()} ${budget.usedBytes()}`, mirrorClock);
			return elapsed;
		}
		function checkBeforeReservation(expected: number[]) {
			assert.ok(cpu.heapServiceActive());
			assert.equal(cpu.readFramePc(caller), newtPc);
			assert.equal(cpu.allocationParked(), false);
			assert.equal(arena.occupiedBytes(), occupied);
			assert.equal(budget.usedBytes(), logical);
			assert.equal(hashBytes(memory.ramData(), state, 0x200), allocator);
			assert.deepEqual([budget.collectionTarget(), ...[epoch, paid, payAt].map(offset => memory.readRamRecordWord(offset))], expected);
			observe(`H ${state} ${state + 0x200}`, allocator);
			observe('P', `${caller + 1} ${newtPc}`);
			for (const address of [management + HEAP_COLLECTION_TARGET_OFFSET, epoch, paid, payAt])
				observe(`H ${address} ${address + 4}`, hashBytes(memory.ramData(), address, 4));
		}
		const initialPolicy = [logical - 128, ...[epoch, paid, payAt].map(offset => memory.readRamRecordWord(offset))];
		const issued = grant(bulk);
		assert.equal(stage(), HeapServiceNewtStage.LogicalAssist);
		checkBeforeReservation(initialPolicy);
		const assist = management + HEAP_SERVICE_NEWT_ASSIST_OFFSET;
		const limit = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET + HeapServiceTraceField.Limit;
		assert.deepEqual([HeapServiceNewtAssistField.Budget, HeapServiceNewtAssistField.EpochBefore, HeapServiceNewtAssistField.Debt,
			HeapServiceNewtAssistField.Pressure, HeapServiceNewtAssistField.ReservationStage].map(field => memory.readRamRecordWord(assist + field)),
			[bulk - issued, initialPolicy[1], charge + 128, 0, HeapServiceNewtStage.Scheduled]);
		assert.equal(memory.readRamRecordWord(limit), logicalPolicy[2]);
		observe(`H ${assist} ${assist + 20}`, hashBytes(memory.ramData(), assist, 20));
		observe(`H ${limit} ${limit + 4}`, hashBytes(memory.ramData(), limit, 4));
		const logicalEntry = captureRuntimeSaveState(runtime);
		assert.ok(grant(1) > 0, 'ordinary BIOS instructions execute before any allocation');
		let paidCycles = 0;
		for (let i = 0; i < 16 && stage() === HeapServiceNewtStage.LogicalAssist; ++i) paidCycles += grant(bulk, true);
		assert.ok(paidCycles > 0);
		assert.equal(stage(), HeapServiceNewtStage.PhysicalAssist);
		checkBeforeReservation(logicalPolicy);
		const physicalAllowance = physicalPolicy[2] - logicalPolicy[2];
		assert.equal(memory.readRamRecordWord(limit), physicalAllowance);
		observe(`H ${limit} ${limit + 4}`, hashBytes(memory.ramData(), limit, 4));
		const checkpoint = captureRuntimeSaveState(runtime);
		writeFileSync(checkpointPath, encodeRuntimeSaveState(checkpoint));
		const prefix = observations.splice(0);
		applyRuntimeSaveState(runtime, logicalEntry);
		for (let i = 0; i < 16384 && stage() === HeapServiceNewtStage.LogicalAssist; ++i)
			scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.equal(stage(), HeapServiceNewtStage.PhysicalAssist, 'retirement on a one-cycle grant still inherits NEWT’s original allowance');
		assert.equal(memory.readRamRecordWord(limit), physicalAllowance);
		assert.equal(arena.occupiedBytes(), occupied);
		applyRuntimeSaveState(runtime, checkpoint);

		function complete() {
			let paidCycles = 0;
			for (let i = 0; i < 16 && stage() === HeapServiceNewtStage.PhysicalAssist; ++i) paidCycles += grant(bulk, true);
			assert.ok(paidCycles > 0);
			assert.equal(stage(), HeapServiceNewtStage.Scheduled);
			checkBeforeReservation(physicalPolicy);
			for (let i = 0; i < 16 && cpu.getFrameDepth() !== 0; ++i) grant(bulk);
			assert.equal(cpu.getFrameDepth(), 0);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(runtime.readCompletionValues()[0], valueInteger(183));
			assert.equal(valueTag(runtime.readCompletionValues()[1]), ValueTag.Table);
			observe('C', 183);
			observe(`H ${state} ${state + 0x200}`, hashBytes(memory.ramData(), state, 0x200));
			return observations.splice(0);
		}
		const tail = complete();
		applyRuntimeSaveState(runtime, checkpoint);
		assert.deepEqual(complete(), tail);
		function run(label: string, commands: string[], statePath: string) {
			const trace = join(directory, `assist-O${optLevel}-${label}.txt`);
			writeFileSync(trace, commands.join('\n'));
			return execFileSync(native, [romPath, trace, statePath], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const commands = (rows: Observation[]) => rows.map(row => row.command);
		const results = (rows: Observation[]) => rows.map(row => row.result);
		const nativeOutput = run('native', ['X', ...commands(prefix), `x ${nativePath}`, ...commands(tail)], seedPath);
		const expected = [...prefix, ...tail];
		assert.equal(nativeOutput.length, expected.length);
		for (const [index, row] of expected.entries()) {
			if (!row.mirrorClock) assert.equal(nativeOutput[index], row.result, row.command);
			else {
				const actual = nativeOutput[index].split(' '), proposed = row.result.split(' ');
				assert.ok(+actual[1] > 0);
				assert.deepEqual([actual[0], ...actual.slice(2)], [proposed[0], ...proposed.slice(2)]);
			}
		}
		// Each originating private frame retains its own operand policy on
		// restore; the same-origin continuation must match exact cycles.
		assert.deepEqual(run('ts-checkpoint', ['X', ...commands(tail)], checkpointPath), results(tail));
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.deepEqual(results(complete()), nativeOutput.slice(prefix.length));
		console.log(`BIOS-NEWT-HEAP-SERVICE:PASS O${optLevel}-scheduled-assist (logical and physical native policy, no premature reservation, cross-core restore)`);

		applyRuntimeSaveState(runtime, atNewt);
		// Exhaust only the test's logical quota. Keep the real allocator
		// untouched and leave enough excess to deny the request after GC.
		const quota = budget.capacity() + budget.usedBytes();
		memory.writeRamRecordWord(budget.occupiedOffset, quota);
		const quotaSeed = join(directory, `logical-quota-O${optLevel}.state`);
		const beforeQuota = captureRuntimeSaveState(runtime);
		writeFileSync(quotaSeed, encodeRuntimeSaveState(beforeQuota));
		const physicalBeforeQuota = arena.occupiedBytes(), now = scheduler.nowCycles;
		const issuedQuota = runtime.cpuExecution.runSuspendedUntilDepth(0, 1);
		const quotaIssue = `${issuedQuota} ${scheduler.nowCycles - now} ${+cpu.heapServiceActive()} ${stage()} ${arena.occupiedBytes()} ${budget.usedBytes()}`;
		assert.equal(stage(), HeapServiceNewtStage.DirectLogicalRecovery);
		assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.MaintenanceRootHead);
		assert.ok(cpu.heapServiceActive());
		assert.equal(cpu.allocationParked(), false);
		assert.equal(cpu.readFramePc(caller), newtPc);
		assert.equal(arena.occupiedBytes(), physicalBeforeQuota);
		assert.equal(budget.usedBytes(), quota);
		const quotaArena = hashBytes(beforeQuota.ram, state, 0x200);
		assert.equal(hashBytes(memory.ramData(), state, 0x200), quotaArena, 'logical refusal is not a physical reservation');
		const reclaimAt = scheduler.nowCycles;
		let visited = 0, lastResult = issuedQuota;
		for (let i = 0; i < 65536 && stage() === HeapServiceNewtStage.DirectLogicalRecovery; ++i) {
			assert.equal(cpu.readFramePc(caller), newtPc);
			visited |= 1 << cpu.gc.serviceStage();
			lastResult = runtime.cpuExecution.runSuspendedUntilDepth(0, 1);
		}
		assert.ok(visited & (1 << HeapServiceGcStage.AllocationRecoveryStringSweep), 'the admitted fresh epoch reached reclamation');
		assert.ok(scheduler.nowCycles > reclaimAt);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(stage(), HeapServiceNewtStage.Idle);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
		assert.equal(cpu.readEpcWord(), newtPc);
		const quotaOutput = run('logical-quota', ['X', 'D 1', `H ${state} ${state + 0x200}`, 'P', `q ${HeapServiceNewtStage.Idle} 65536`, 'Z'], quotaSeed);
		assert.deepEqual(quotaOutput.slice(0, 3), [quotaIssue, String(quotaArena), `${caller + 1} ${newtPc}`]);
		const [returned, elapsed, active, retiredStage, physical, used, mask] = quotaOutput[3].split(' ').map(Number);
		assert.ok(elapsed > 0);
		assert.deepEqual([returned, active, retiredStage, physical, used, mask], [lastResult, 0, HeapServiceNewtStage.Idle, arena.occupiedBytes(), budget.usedBytes(), visited]);
		assert.equal(quotaOutput[4], `${cpu.readCauseWord()} ${LUA_FAULT_REASON_OUT_OF_MEMORY} ${newtPc}`);
		console.log(`BIOS-NEWT-HEAP-SERVICE:PASS O${optLevel}-direct-logical-quota (an admitted epoch before original-PC OOM, no premature reservation)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
