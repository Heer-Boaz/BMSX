import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { HASH_STORE_DECLINED, HASH_STORE_PENDING, TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { type Value, hashCanonicalTableKey, valueInteger, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const ENTRY = 'kernel/table_resize', NAME = 'execute_staged_table_growth';
const modules = ['kernel/table_prepare_rebuild'].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const halt = 'halt_until_irq';
const jobSentinel = 0xb9c82f31;
const oldResult = [0x142d231d, 0xd62c1a75] as const;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(halt), modules, { entrySource: halt, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === ENTRY && entry.exportPathKey === NAME);
	assert.ok(symbol);
	const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
	assert.ok(root >= 0);
	assert.equal(linked.image.functions[root].numParams, 6);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [root]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack ${frames}/${valueSlots}`);
	function runtime() {
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		runGuestToHalt(runtime.machine.cpu, 10_000);
		return runtime;
	}
	return { runtime, entry: linked.image.functions[root].address };
}

for (const optLevel of [0, 3] as const) {
	test(`staged reservation through complete assignment is one real deadline-clocked BIOS activation at O${optLevel}`, () => {
		const { runtime, entry } = fixture(optLevel);
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
			const reservation = both(target => target.heapAllocator.allocate(40, true)) - RAM_BASE;
			const record = both(target => target.createTable(oldArray, oldHash));
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
					for (const index of [1, 5, oldArray - 1]) target.gc.tables.set(record, valueInteger(index + 1), valueInteger(11 * index));
					target.gc.tables.set(record, valueInteger(-7), valueInteger(1773));
				}
				for (const [index, collider] of collisions.slice(1).entries()) {
					target.gc.tables.set(record, collider, valueInteger(101 + index));
				}
				const request = [...oldResult, valueTag(key), valuePayload(key), valueTag(value), valuePayload(value),
					0, 0, +keep, TableRecords.hashStorageBytes(hash)];
				for (const [index, word] of request.entries()) target.memory.writeRamRecordWord(reservation + index * 4, word);
			});
			const tables = oracle.gc.tables, plan = tables['resizePlan'];
			plan.array = array; plan.hash = hash; plan.keepHash = keep;
			oracle.instructionBudgetRemaining = 1 << 24;
			assert.equal(tables['resize'](record, key, value, TableRecords.allocationCharge(oldArray, oldHash),
				TableRecords.allocationCharge(array, hash), oracle), blocked ? HASH_STORE_DECLINED : HASH_STORE_PENDING);
			assert.equal(oracle.tableRebuild.record, 0, 'reference passes the original whole rebuild');
			const initial = captureRuntimeSaveState(guest);
			const begin = () => assert.ok(cpu.beginHeapService(entry, [management, record, array, hash, +(array > oldArray && oldArray >= 1024), reservation]));
			const pay = (fragment: number) => {
				runDueRuntimeTimers(guest);
				const grant = Math.min(fragment, scheduler.nextDeadline() - scheduler.nowCycles);
				assert.ok(grant > 0);
				assert.equal(scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
				const used = grant - cpu.instructionBudgetRemaining;
				assert.ok(used > 0);
				advanceRuntimeTime(guest, used);
			};
			const finish = (fragment: number) => {
				for (let i = 0; i < 60000 && cpu.heapServiceActive(); ++i) pay(fragment);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(cpu.heapServiceResult(), blocked ? 0 : 1);
				const start = memory.ramBusEnd() - RAM_BASE, end = management + HEAP_SERVICE_THREAD_OFFSET;
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
				assert.equal(cpu.heapServiceActive(), true);
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
