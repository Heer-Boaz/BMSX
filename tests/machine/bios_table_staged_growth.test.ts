import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CPU, CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { advanceTableRebuildReference, TableRebuildReference } from '../helpers/table_rebuild_reference';
import { type Value, hashCanonicalTableKey, valueInteger, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { runGuestToHalt } from '../helpers/cpu_execution';

import { admitTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const ENTRY = 'kernel/table_resize', NAME = 'execute_staged_table_growth';
const jobSentinel = 0xb9c82f31;
const oldResult = [0x142d231d, 0xd62c1a75] as const;

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, [], [{ path: ENTRY, member: NAME, arity: 6 }]);
	function runtime() {
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, executionAddressSpace } = runtime.machine;
		admitTestHeapServiceCpu(cpu, executionAddressSpace);
		runGuestToHalt(cpu, 10_000);
		return runtime;
	}
	return runtime;
}

for (const optLevel of [0, 3] as const) {
	test(`staged reservation through complete assignment is one real deadline-clocked BIOS activation at O${optLevel}`, () => {
		const runtime = fixture(optLevel);
		for (const [oldArray, array, oldHash, hash, keep] of [
			[0, 0, 128, 256, false], [1024, 2048, 8, 8, true], [2048, 1024, 128, 1024, false],
			[1024, 1 << 20, 8, 128, false],
		] as const) {
			const guest = runtime(), old = runtime();
			const { cpu, memory, scheduler } = guest.machine, oracle = old.machine.cpu;
			function both<R>(action: (target: CPU) => R): R {
				const result = action(cpu);
				assert.deepEqual(action(oracle), result);
				return result;
			}
			const management = cpu.heapAllocator.managementOffset(), job = management, jobSize = 64;
			const reservation = both(target => nativeHeapReference(target).heapAllocator.allocate(40, true)) - RAM_BASE;
			const record = both(target => createReferenceTable(target, oldArray, oldHash));
			assert.ok(reservation > 0);
			const oldWords = cpu.gc.tables.arrayAddress(record), oldStorage = cpu.gc.tables.hashAddress(record);
			const blocked = 5 * array > cpu.heapAllocator.capacityBytes();
			const collisions: Value[] = [];
			if (oldArray === 0) {
				for (let key = -1; collisions.length < 4; --key) {
					const value = valueInteger(key);
					if ((hashCanonicalTableKey(value) & (hash - 1)) === hash - 1) collisions.push(value);
				}
			}
			const key = oldArray === 0 ? collisions[0] : valueInteger(keep ? array : oldArray + 1);
			const value = valueInteger(1409);
			both(target => {
				for (let offset = job; offset < job + jobSize; offset += 4) target.memory.writeRamRecordWord(offset, jobSentinel);
				if (oldArray > 0) {
					for (const index of [1, 5, oldArray - 1]) nativeHeapReference(target).gc.tables.set(record, valueInteger(index + 1), valueInteger(11 * index));
					nativeHeapReference(target).gc.tables.set(record, valueInteger(-7), valueInteger(1773));
				}
				for (const [index, collider] of collisions.slice(1).entries()) {
					nativeHeapReference(target).gc.tables.set(record, collider, valueInteger(101 + index));
				}
				const request = [...oldResult, valueTag(key), valuePayload(key), valueTag(value), valuePayload(value),
					0, 0, +keep, TableRecords.hashStorageBytes(hash)];
				for (const [index, word] of request.entries()) target.memory.writeRamRecordWord(reservation + index * 4, word);
			});
			const arena = nativeHeapReference(oracle).heapAllocator;
			const storage = keep ? 0 : arena.allocate(TableRecords.hashStorageBytes(hash), true);
			assert.ok(keep || storage);
			const base = array > oldArray ? arena.reserveBacking(oldWords, 5 * array) : oldWords;
			if (blocked) {
				assert.equal(base, 0);
				arena.free(storage);
			} else {
				const capacity = keep ? 0 : hash, moved = array !== oldArray;
				const reference = Object.assign(new TableRebuildReference(), {
					record, source: keep ? 0 : oldStorage, count: keep ? 0 : oldHash, storage, capacity,
					arrayStorage: moved ? base : 0, arraySlots: moved ? array : 0, free: capacity - 1, key, value,
				});
				advanceTableRebuildReference(nativeHeapReference(oracle).gc, reference, 1 << 24);
				assert.equal(reference.record, 0, 'reference completes the original staged rebuild');
			}
			const initial = captureRuntimeSaveState(guest);
			const begin = () => issueFirmwareProbe(cpu, [management, record, array, hash, +(array > oldArray && oldArray >= 1024), reservation]);
			const pay = (fragment: number) => {
				runDueRuntimeTimers(guest);
				const grant = Math.min(fragment, scheduler.nextDeadline() - scheduler.nowCycles);
				assert.ok(grant > 0);
				const result = scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled);
				assert.ok(result === RunResult.Yielded || (result === RunResult.Halted && cpu.isHaltedUntilIrq()));
				const used = grant - cpu.instructionBudgetRemaining;
				assert.ok(used > 0);
				advanceRuntimeTime(guest, used);
			};
			const finish = (fragment: number) => {
				for (let i = 0; i < 60000 && !cpu.isHaltedUntilIrq(); ++i) pay(fragment);
				assert.equal(firmwareProbeResult(cpu), blocked ? 0 : 1);
				const start = memory.ramBusEnd() - RAM_BASE, end = management + GC_WORKSPACE_END;
				for (const [from, to] of [[start, reservation], [reservation + 8, job], [job + jobSize, end]]) {
					const got = memory.ramData().subarray(from, to), wanted = oracle.memory.ramData().subarray(from, to);
					const diff = got.findIndex((byte, index) => byte !== wanted[index]);
					assert.equal(diff, -1, diff < 0 ? undefined : `private byte 0x${(from + diff).toString(16)}`);
				}
				return scheduler.nowCycles;
			};
			begin();
			// The first prepared word is in private RAM and must appear before
			// the old Table headers change. On refusal no job word is written.
			if (!blocked) {
				for (let i = 0; i < 4096 && memory.readRamRecordWord(job + 28) === jobSentinel; ++i) pay(1);
				assert.ok(cpu.fixedInterruptActive());
				assert.equal(memory.readRamRecordWord(record + TableHeader.ArrayStorage), oldWords);
				assert.equal(memory.readRamRecordWord(record + TableHeader.HashStorage), oldStorage);
				cpu.requestNonMaskableInterrupt();
				assert.equal(cpu.enterPendingInterrupt(), false);
				cpu.cancelNonMaskableInterrupt();
			}
			const checkpoint = captureRuntimeSaveState(guest);
			const time = finish(29);
			applyRuntimeSaveState(guest, checkpoint);
			assert.equal(finish(4096), time, 'refeeding the same hardware deadlines with different grants preserves exact time');
			if (blocked) {
				assert.deepEqual([memory.readRamRecordWord(reservation), memory.readRamRecordWord(reservation + 4)], oldResult);
				assert.equal(memory.readRamRecordWord(job + 28), jobSentinel);
			} else {
				assert.equal(cpu.gc.tables.get(record, key), value);
				if (keep) assert.equal(cpu.gc.tables.hashAddress(record), oldStorage);
			}
			applyRuntimeSaveState(guest, initial);
			begin();
			assert.equal(finish(131), time);
		}
	});
}
