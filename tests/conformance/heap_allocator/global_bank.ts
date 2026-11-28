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
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET } from '../../../machine/ts/spec/blua32/execution_domain';
import { readNamespaceBank } from '../../helpers/cpu_execution';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';

const path = 'kernel/global_bank';
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const descriptorBytes = 12, backingBytes = 17;
const allocatorStateBytes = 24 + 33 * 8 + 32 * 4 + 16; // shared dlmalloc controls and bins
const candidates = Array.from({ length: 18 }, (_, index) => `namespace_${index}`);
const words = Array.from(candidates, (_, index) => index % 2 === 0 ? 0xb1670030 + index : 0x80000000 + index);
const dir = mkdtempSync(join('tmp', 'authored-global-bank-'));

try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const linked = linkManagedTestSystem('halt_until_irq', opt);
		const bytes = writeTestBlua32Rom(linked);
		function entry(key: string) {
			const index = linked.symbols.metadata.functionIds.findIndex(id =>
				id.startsWith(`module:${path}/`) && id.endsWith(`|constant|${key}`));
			assert.ok(index >= 0, key);
			deriveBlua32FixedStack(linked.layout, [index]);
			return linked.layout.functions[index].address;
		}
		const commit = entry('commit_name'), find = entry('find_name'), growth = entry('growth_capacity');
		const rom = join(dir, `O${opt}.rom`), script = join(dir, 'trace'), initial = join(dir, 'initial'), portable = join(dir, 'partial');
		writeFileSync(rom, bytes);

		const runtime = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		const oracle = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		for (const subject of [runtime, oracle]) {
			subject.boot();
			const { cpu, scheduler } = subject.machine;
			for (let i = 0; i < 1024 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++i)
				scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
			assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		}
		const { cpu, memory, scheduler } = runtime.machine, ram = memory.ramData(), arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
		const old = oracle.machine.cpu, oldArena = nativeHeapReference(old).heapAllocator, oldMem = oracle.machine.memory, oldRam = oldMem.ramData();
		const keys = candidates.map(name => {
			const key = nativeHeapReference(cpu).stringPool.intern(name);
			assert.equal(nativeHeapReference(old).stringPool.intern(name), key);
			return key;
		});
		const preexisting = readNamespaceBank(memory, management + GLOBAL_BANK_OFFSET);
		assert.deepEqual(preexisting, { base: 0, capacity: 0, count: 0 });
		const bank = arena.allocate(descriptorBytes, true);
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

		function start(fn: number, args: readonly number[]) {
			assert.ok(cpu.beginHeapService(fn, args));
			observe(`B ${fn} ${args.length} ${args.join(' ')}`, 1);
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(result, RunResult.Yielded);
			assert.ok(paid > 0);
			observe(`J ${cycles} 1`, `${result} ${paid} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
		}
		function finish(result: number) {
			for (let grants = 0; grants < 4096 && cpu.heapServiceActive(); ++grants) grant(37);
			assert.equal(cpu.heapServiceResult(), result >>> 0);
		}
		let collided = false;
		for (let i = 0; i < candidates.length; ++i) {
			const key = keys[i], prior = readNamespaceBank(oldMem, management + GLOBAL_BANK_OFFSET);
			start(find, [bank, key]);
			finish(-1);
			const nextCapacity = i === prior.capacity ? (prior.capacity === 0 ? 8 : 2 * prior.capacity) : 0;
			start(growth, [bank]);
			finish(nextCapacity);
			let backing = 0;
			if (nextCapacity !== 0) {
				backing = arena.allocate(backingBytes * nextCapacity, true);
				assert.notEqual(backing, 0);
				observe(`A ${backingBytes * nextCapacity}`, backing);
			}
			setReferenceGlobal(old, key, valueNil());
			oracleObserve(`f ${candidates[i]}`, '0 0');
			const expect = readNamespaceBank(oldMem, management + GLOBAL_BANK_OFFSET);
			if (nextCapacity !== 0) assert.equal(backing, expect.base);
			start(commit, [management, bank, key, backing, nextCapacity]);
			if (i === 8) {
				for (let grants = 0; grants < 1024 && memory.readRamRecordWord(bank) !== backing; ++grants) grant(1);
				assert.ok(cpu.heapServiceActive());
				assert.equal(memory.readRamRecordWord(bank), backing);
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
				[expect.base, expect.capacity, expect.count]);
			assert.deepEqual(ram.subarray(base, base + backingBytes * expect.capacity), oldRam.subarray(base, base + backingBytes * expect.capacity));
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(old).luaHeap.usedBytes());
			assert.equal(arena.occupiedBytes(), oldArena.occupiedBytes());
			hash(base, backingBytes * expect.capacity);
			nativeHash(base, backingBytes * expect.capacity);
			const arenaState = arena.allocatorStateOffset();
			// Bin heads, chunk links and total use must agree after retiring a
			// replaced bank, not just the surviving contents of the new bank.
			assert.deepEqual(ram.subarray(arenaState, arenaState + allocatorStateBytes), oldRam.subarray(arenaState, arenaState + allocatorStateBytes));
			hash(arenaState, allocatorStateBytes);
			nativeHash(arenaState, allocatorStateBytes);
			const bucket = hashCanonicalTableKey(valueInteger(key)) & (2 * expect.capacity - 1);
			collided ||= memory.readRamRecordWord(expect.base + 4 * (expect.capacity + bucket)) !== i + 1;

			start(find, [bank, key]);
			finish(i);
			// Distinct non-Nil payloads and tags must survive the next bank move.
			const dataWord = expect.base + 12 * expect.capacity + 4 * i;
			const dataTag = expect.base + 16 * expect.capacity + i;
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
		const nativeResult = (commands: string[], checkpoint = initial) => {
			writeFileSync(script, commands.join('\n'));
			return execFileSync(native, [rom, script, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		};
		assert.deepEqual(nativeResult(nativeOracle), nativeObservations);
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
		for (const [index, word] of [prior.base, prior.capacity, prior.count].entries()) oldMem.writeRamRecordWord(bank + 4 * index, word);
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
		start(commit, [management, bank, barrierKey, 0, 0]);
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
		assert.deepEqual(nativeResult(nativeOracle, markPath), nativeObservations);
		assert.deepEqual(nativeResult(trace, markPath), observations);
		console.log(`GLOBAL-BANK:PASS O${opt} C++/TS native and BIOS agree on ordinals, full backing, payload preservation and interrupted publication`);
	}
	// Actual GET/SET instructions in both namespaces, across a committed
	// relocation. Neither cross-core restore can consult a host copy of the
	// former base or use a view from the other history branch.
	{
		const linked = linkManagedTestSystem(`
ordinary_counter = 10
function irq() end
irq = 100
while true do
	ordinary_counter = ordinary_counter + 1
	irq = irq + 1
end`, 0);
		const code = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: code, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
		for (let i = 0; i < 1024 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++i)
			scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
		assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		const key = nativeHeapReference(cpu).stringPool.find('ordinary_counter')!, systemKey = nativeHeapReference(cpu).stringPool.find('irq')!;
		for (let i = 0; i < 256 * 1024 && cpu.getSystemGlobalByKey(systemKey) !== valueInteger(100); ++i)
			scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.equal(cpu.getGlobalByKey(key), valueInteger(10));
		assert.equal(cpu.getSystemGlobalByKey(systemKey), valueInteger(100));
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
		const pulse = () => {
			const cycles = 4096;
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(result, RunResult.Yielded);
			assert.ok(paid >= cycles);
			note(`J ${cycles} 1`, `${result} ${paid} 0 0 ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
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
		for (let i = 0; i < 16; ++i) {
			const name = `physical_global_${i}`;
			setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.intern(name), valueNil());
			note(`f ${name}`, '0 0');
		}
		const grown = readNamespaceBank(memory, execution);
		assert.equal(grown.count, first.count + 16);
		assert.notEqual(grown.base, first.base);
		assert.deepEqual(readNamespaceBank(memory, system), stableSystem);
		writeFileSync(tsAfter, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		note(`x ${cppAfter}`);
		const nextTrace = trace.length, nextObservation = observations.length;
		pulse();
		assert.notEqual(cpu.getGlobalByKey(key), valueInteger(10), 'ordinary GET/SET ran through the relocated view');
		assert.notEqual(cpu.getSystemGlobalByKey(systemKey), valueInteger(100), 'System GET/SET ran through its own view');
		const grownTrace = trace.slice(nextTrace), grownResult = observations.slice(nextObservation);
		const ramAfter = history.capture(memory, ramBefore);
		history.restore(memory, ramAfter, ramBefore);
		applyRuntimeCheckpointState(runtime, beforeGrowth, RuntimeRestoreOrigin.HistorySeek);
		note('u');
		assert.deepEqual(readNamespaceBank(memory, execution), first);
		assert.equal(cpu.getGlobalByKey(key), valueInteger(10));
		assert.equal(cpu.getSystemGlobalByKey(systemKey), valueInteger(100));
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
