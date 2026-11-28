import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { hashCanonicalTableKey, valueInteger, valueNil, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET } from '../../../machine/ts/spec/blua32/execution_domain';
import { readNamespaceBank } from '../../helpers/cpu_execution';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const descriptorBytes = 12, backingBytes = 17;
const allocatorStateBytes = 24 + 33 * 8 + 32 * 4 + 16; // shared dlmalloc controls and bins
const candidates = Array.from({ length: 18 }, (_, index) => `namespace_${index}`);
const words = Array.from(candidates, (_, index) => index % 2 === 0 ? 0xb1670030 + index : 0x80000000 + index);
const enum Probe { Find = 1, Growth, Commit, Allocate }
const dir = mkdtempSync(join('tmp', 'authored-global-bank-'));

try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const nativeReference = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const linked = linkManagedTestSystem(`
local globals<const> = require('kernel/global_bank')
local arena<const> = require('kernel/dlmalloc')
bss mailbox: u32[7]
while true do
	halt_until_irq
	local operation<const> = mailbox[0]
	if operation == ${Probe.Find} then
		mailbox[6] = globals.find_name(mailbox[1], mailbox[2])
	elseif operation == ${Probe.Growth} then
		mailbox[6] = globals.growth_capacity(mailbox[1])
	elseif operation == ${Probe.Commit} then
		mailbox[6] = globals.commit_name(mailbox[1], mailbox[2], mailbox[3], mailbox[4], mailbox[5])
	elseif operation == ${Probe.Allocate} then
		mailbox[6] = ${RAM_BASE} + arena.bmsx_dlmalloc_allocate(mailbox[1], mailbox[2], 0)
	end
end`, opt);
		const bytes = writeTestBlua32Rom(linked);
		const mailbox = linked.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'mailbox')!.address!;
		const rom = join(dir, `O${opt}.rom`), script = join(dir, 'trace'), initial = join(dir, 'initial'), portable = join(dir, 'partial');
		writeFileSync(rom, bytes);

		const runtime = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		const oracle = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		for (const subject of [runtime, oracle]) {
			subject.boot();
			const { cpu, scheduler } = subject.machine;
			for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i)
				scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
			assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			assert.ok(cpu.isHaltedUntilIrq());
			// Keep ordinary CALL window acquisition outside the allocator comparison.
			const parked = cpu.rootThread;
			cpu.requestRegisterWindow(512, 64, scheduler.cyclesUntilDeadline());
			let outcome = CpuSuspendedRunResult.Yielded;
			for (let grants = 0; grants < 128 && outcome === CpuSuspendedRunResult.Yielded; ++grants)
				outcome = subject.cpuExecution.runSuspendedUntilDepth(parked.frameDepth, 4096, parked.address);
			assert.equal(outcome, CpuSuspendedRunResult.Completed);
			assert.ok(cpu.isHaltedUntilIrq());
			assert.ok(parked.stackRegisters.capacity() >= 512);
		}
		const { cpu, memory, scheduler } = runtime.machine, ram = memory.ramData(), arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
		const old = oracle.machine.cpu, oldArena = nativeHeapReference(old).heapAllocator, oldMem = oracle.machine.memory, oldRam = oldMem.ramData();
		const keys = candidates.map(name => {
			const key = nativeHeapReference(cpu).stringPool.intern(name);
			assert.equal(nativeHeapReference(old).stringPool.intern(name), key);
			return key;
		});
		const preexisting = readNamespaceBank(memory, management + GLOBAL_BANK_OFFSET);
		assert.deepEqual(preexisting, { base: 0, values: 0, capacity: 0, count: 0 });
		const bank = arena.allocate(descriptorBytes, true);
		assert.notEqual(bank, 0);
		assert.equal(oldArena.allocate(descriptorBytes, true), bank);
		ram.fill(0, bank - RAM_BASE, bank - RAM_BASE + descriptorBytes);
		oldRam.fill(0, bank - RAM_BASE, bank - RAM_BASE + descriptorBytes);

		const trace: string[] = [], observations: string[] = [], nativeOracle: string[] = ['X'], nativeObservations: string[] = [];
		const observe = (command: string, expect?: string | number) => {
			trace.push(command);
			if (expect !== undefined) observations.push(String(expect));
		};
		const oracleObserve = (command: string, expect?: string | number) => {
			nativeOracle.push(command);
			if (expect !== undefined) nativeObservations.push(String(expect));
		};
		const hash = (first: number, bytes: number) => observe(`H ${first} ${first + bytes}`, hashBytes(ram, first, bytes));
		const nativeHash = (first: number, bytes: number) => oracleObserve(`H ${first} ${first + bytes}`, hashBytes(oldRam, first, bytes));
		writeFileSync(initial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		observe('X');

		function start(operation: Probe, args: readonly number[]) {
			assert.ok(cpu.isHaltedUntilIrq());
			for (const [index, word] of [operation, ...args].entries()) {
				const address = mailbox + 4 * index;
				memory.writeRamRecordWord(address, word);
				observe(`W ${address} ${word}`);
			}
			cpu.clearHaltUntilIrq();
			observe('h');
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.ok(paid > 0);
			assert.equal(result, cpu.isHaltedUntilIrq() ? RunResult.Halted : RunResult.Yielded);
			observe(`E ${cycles}`, `${result} ${paid} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		}
		function finish(result: number) {
			for (let grants = 0; grants < 4096 && !cpu.isHaltedUntilIrq(); ++grants) grant(37);
			assert.ok(cpu.isHaltedUntilIrq());
			assert.equal(memory.readRamRecordWord(mailbox + 24), result >>> 0);
			hash(mailbox + 24 - RAM_BASE, 4);
		}
		let collided = false;
		for (let i = 0; i < candidates.length; ++i) {
			const key = keys[i], prior = readNamespaceBank(oldMem, management + GLOBAL_BANK_OFFSET);
			start(Probe.Find, [bank, key]);
			finish(-1);
			const nextCapacity = i === prior.capacity ? (prior.capacity === 0 ? 8 : 2 * prior.capacity) : 0;
			start(Probe.Growth, [bank]);
			finish(nextCapacity);
			setReferenceGlobal(old, key, valueNil());
			oracleObserve(`f ${candidates[i]}`, '0 0');
			const expect = readNamespaceBank(oldMem, management + GLOBAL_BANK_OFFSET);
			const backing = nextCapacity === 0 ? 0 : expect.base;
			if (nextCapacity !== 0) {
				assert.notEqual(backing, 0);
				start(Probe.Allocate, [arena.allocatorStateOffset(), backingBytes * nextCapacity]);
				finish(backing);
			}
			start(Probe.Commit, [management, bank, key, backing, nextCapacity]);
			if (i === 8) {
				for (let grants = 0; grants < 4096 && memory.readRamRecordWord(bank) !== expect.values; ++grants) grant(1);
				assert.ok(!cpu.isHaltedUntilIrq());
				assert.equal(memory.readRamRecordWord(bank), expect.values);
				assert.equal(memory.readRamRecordWord(bank + 8), 8, 'new name is not yet visible');
				hash(bank - RAM_BASE, descriptorBytes);
				const partial = captureRuntimeSaveState(runtime);
				observe(`x ${portable}`);
				observe('S');
				finish(i);
				applyRuntimeSaveState(runtime, partial);
				observe('U');
			}
			finish(i);

			const base = expect.base & RAM_RECORD_WORD_MASK;
			assert.deepEqual([memory.readRamRecordWord(bank), memory.readRamRecordWord(bank + 4), memory.readRamRecordWord(bank + 8)],
				[expect.values, expect.capacity, expect.count]);
			assert.deepEqual(ram.subarray(base, base + backingBytes * expect.capacity), oldRam.subarray(base, base + backingBytes * expect.capacity));
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(old).luaHeap.usedBytes());
			assert.equal(arena.occupiedBytes(), oldArena.occupiedBytes());
			hash(base, backingBytes * expect.capacity);
			nativeHash(base, backingBytes * expect.capacity);
			hash(management + HEAP_LOGICAL_OCCUPIED_OFFSET, 4);
			nativeHash(management + HEAP_LOGICAL_OCCUPIED_OFFSET, 4);
			const arenaState = arena.allocatorStateOffset();
			// Bin heads, chunk links and total use must agree after retiring a
			// replaced bank, not just the surviving contents of the new bank.
			assert.deepEqual(ram.subarray(arenaState, arenaState + allocatorStateBytes), oldRam.subarray(arenaState, arenaState + allocatorStateBytes));
			hash(arenaState, allocatorStateBytes);
			nativeHash(arenaState, allocatorStateBytes);
			const bucket = hashCanonicalTableKey(valueInteger(key)) & (2 * expect.capacity - 1);
			collided ||= memory.readRamRecordWord(expect.base + 4 * (expect.capacity + bucket)) !== i + 1;

			start(Probe.Find, [bank, key]);
			finish(i);
			// Distinct non-Nil payloads and tags must survive the next bank move.
			const dataWord = expect.values + 4 * i;
			const dataTag = expect.values + 4 * expect.capacity + i;
			for (const mem of [memory, oldMem]) {
				mem.writeRamRecordWord(dataWord, words[i]);
				mem.writeRamRecordByte(dataTag, ValueTag.Integer);
			}
			const tagWord = dataTag & ~3;
			for (const append of [observe, oracleObserve]) {
				append(`W ${dataWord} ${words[i]}`);
				append(`W ${tagWord} ${memory.readRamRecordWord(tagWord)}`);
			}
		}
		assert.ok(collided, 'expected to exercise probing beyond a home bucket');
		const nativeResult = (commands: string[], checkpoint = initial, runner = native) => {
			writeFileSync(script, commands.join('\n'));
			return execFileSync(runner, [rom, script, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		};
		assert.deepEqual(nativeResult(nativeOracle, initial, nativeReference), nativeObservations);
		assert.deepEqual(nativeResult(trace), observations);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(portable), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish(8);
		assert.equal(memory.readRamRecordWord(bank + 8), 9);

		// Start a real marking epoch with a borrowed unmarked String. A
		// native raw-ID setter avoids reinterning (which itself retains it).
		const barrierKey = nativeHeapReference(old).stringPool.intern('namespace_pending_name');
		nativeHeapReference(old).gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(nativeHeapReference(old).gc.phase(), GcPhase.Mark);
		const markByte = oldMem.readRamRecordByte(barrierKey + 1);
		const prior = readNamespaceBank(oldMem, management + GLOBAL_BANK_OFFSET);
		assert.ok(prior.count < prior.capacity);
		for (const [index, word] of [prior.values, prior.capacity, prior.count].entries()) oldMem.writeRamRecordWord(bank + 4 * index, word);
		const markStart = captureRuntimeSaveState(oracle);
		const markPath = join(dir, 'mark');
		writeFileSync(markPath, encodeRuntimeSaveState(markStart));
		applyRuntimeSaveState(runtime, markStart);
		setReferenceGlobal(old, barrierKey, valueNil());
		assert.notEqual(oldMem.readRamRecordByte(barrierKey + 1), markByte);
		assert.equal(oldMem.readRamRecordWord(management + HEAP_STRING_MARK_WORK_OFFSET), 0);

		trace.length = observations.length = nativeOracle.length = nativeObservations.length = 0;
		observe('X');
		oracleObserve('X');
		start(Probe.Commit, [management, bank, barrierKey, 0, 0]);
		finish(prior.count);
		oracleObserve(`k ${barrierKey}`);
		assert.equal(memory.readRamRecordWord(bank + 8), prior.count + 1);
		const metadata = management + HEAP_STRING_METADATA_OFFSET, state = arena.allocatorStateOffset();
		const keyOffset = barrierKey & RAM_RECORD_WORD_MASK, data = prior.base & RAM_RECORD_WORD_MASK;
		for (const [base, size] of [[metadata, state - metadata], [keyOffset, 4], [data, backingBytes * prior.capacity]]) {
			assert.deepEqual(ram.subarray(base, base + size), oldRam.subarray(base, base + size));
			hash(base, size);
			nativeHash(base, size);
		}
		assert.deepEqual(nativeResult(nativeOracle, markPath, nativeReference), nativeObservations);
		assert.deepEqual(nativeResult(trace, markPath), observations);
		console.log(`GLOBAL-BANK:PASS O${opt} C++/TS guest and native reference agree on ordinals, full backing, payload preservation and interrupted publication`);
	}
	// Actual GET/SET instructions in both namespaces, across a committed
	// relocation. Neither cross-core restore can consult a host copy of the
	// former base or use a view from the other history branch.
	{
		const linked = linkManagedTestSystem(`
local set_name<const> = require('kernel/set_global_entry')
bss grow_names: u32
ordinary_counter = 10
function irq() end
irq = 100
halt_until_irq
if grow_names ~= 0 then
	${Array.from({ length: 16 }, (_, i) => `set_name('physical_global_${i}', nil)`).join('\n\t')}
	halt_until_irq
end
while true do
	ordinary_counter = ordinary_counter + 1
	irq = irq + 1
end`, 0);
		const growNames = linked.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'grow_names')!.address!;
		const code = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: code, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
		for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i)
			scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
		assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.ok(cpu.isHaltedUntilIrq());
		const key = nativeHeapReference(cpu).stringPool.find('ordinary_counter')!, systemKey = nativeHeapReference(cpu).stringPool.find('irq')!;
		assert.equal(readStockGlobalValue(cpu.memory, key), valueInteger(10));
		assert.equal(readStockGlobalValue(cpu.memory, systemKey, SYSTEM_GLOBAL_BANK_OFFSET), valueInteger(100));
		const execution = management + GLOBAL_BANK_OFFSET, system = management + SYSTEM_GLOBAL_BANK_OFFSET;
		const first = readNamespaceBank(memory, execution), stableSystem = readNamespaceBank(memory, system);
		assert.notEqual(first.base, stableSystem.base);
		const rom = join(dir, 'ordinary.rom'), script = join(dir, 'ordinary-trace');
		const before = join(dir, 'ordinary-before'), cppAfter = join(dir, 'ordinary-native-grown'), tsAfter = join(dir, 'ordinary-ts-grown');
		writeFileSync(rom, code);
		writeFileSync(before, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));

		const trace: string[] = [], observations: string[] = [];
		const note = (command: string, result?: string | number) => {
			trace.push(command);
			if (result !== undefined) observations.push(String(result));
		};
		const release = () => {
			cpu.clearHaltUntilIrq();
			note('h');
		};
		const grant = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			note(`E ${cycles}`, `${result} ${paid} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		};
		const pulse = () => {
			release();
			assert.equal(grant(4096), RunResult.Yielded);
			const ram = memory.ramData();
			for (const descriptor of [execution, system]) {
				const { base, capacity } = readNamespaceBank(memory, descriptor);
				const offset = base - RAM_BASE, end = offset + backingBytes * capacity;
				note(`H ${descriptor} ${descriptor + descriptorBytes}`, hashBytes(ram, descriptor, descriptorBytes));
				note(`H ${offset} ${end}`, hashBytes(ram, offset, end - offset));
			}
		};
		const nativeTrace = (commands: string[], seed: string) => {
			writeFileSync(script, commands.join('\n'));
			return execFileSync(native, [rom, script, seed], { encoding: 'utf8' }).trimEnd().split('\n');
		};
		const history = new RamHistory();
		history.start(memory);
		const ramBefore = history.capture(memory, null);
		const beforeGrowth = captureRuntimeCheckpointState(runtime);
		note('X'); note('l'); note('s');
		memory.writeRamRecordWord(growNames, 1);
		note(`W ${growNames} 1`);
		release();
		for (let grants = 0; grants < 1024 && !cpu.isHaltedUntilIrq(); ++grants) grant(4096);
		assert.ok(cpu.isHaltedUntilIrq());
		const grown = readNamespaceBank(memory, execution);
		assert.equal(grown.count, first.count + 16);
		assert.notEqual(grown.base, first.base);
		assert.deepEqual(readNamespaceBank(memory, system), stableSystem);
		writeFileSync(tsAfter, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		note(`x ${cppAfter}`);
		const nextTrace = trace.length, nextObservation = observations.length;
		pulse();
		assert.notEqual(readStockGlobalValue(cpu.memory, key), valueInteger(10), 'ordinary GET/SET ran through the relocated view');
		assert.notEqual(readStockGlobalValue(cpu.memory, systemKey, SYSTEM_GLOBAL_BANK_OFFSET), valueInteger(100), 'System GET/SET ran through its own view');
		const grownTrace = trace.slice(nextTrace), grownResult = observations.slice(nextObservation);
		const ramAfter = history.capture(memory, ramBefore);
		history.restore(memory, ramAfter, ramBefore);
		applyRuntimeCheckpointState(runtime, beforeGrowth, RuntimeRestoreOrigin.HistorySeek);
		note('u');
		assert.deepEqual(readNamespaceBank(memory, execution), first);
		assert.equal(readStockGlobalValue(cpu.memory, key), valueInteger(10));
		assert.equal(readStockGlobalValue(cpu.memory, systemKey, SYSTEM_GLOBAL_BANK_OFFSET), valueInteger(100));
		pulse();
		assert.deepEqual(nativeTrace(trace, before), observations);
		assert.deepEqual(nativeTrace(['X', ...grownTrace], tsAfter), grownResult);

		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppAfter), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.deepEqual(readNamespaceBank(memory, execution), grown);
		trace.length = observations.length = 0;
		pulse();
		assert.deepEqual(trace, grownTrace);
		assert.deepEqual(observations, grownResult);
		console.log('GLOBAL-BANK:PASS ordinary and System opcodes, relocated RAM namespaces, cross-core checkpoints and rewind');
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
