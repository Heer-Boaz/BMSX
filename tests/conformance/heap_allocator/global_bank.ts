import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { hashCanonicalTableKey, valueInteger, valueNil, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const path = 'kernel/global_bank';
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const modules = [{ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }];
const descriptorBytes = 12, backingBytes = 17;
const allocatorStateBytes = 24 + 33 * 8 + 32 * 4 + 16; // shared dlmalloc controls and bins
const candidates = Array.from({ length: 18 }, (_, index) => `namespace_${index}`);
const words = Array.from(candidates, (_, index) => index % 2 === 0 ? 0xb1670030 + index : 0x80000000 + index);
const dir = mkdtempSync(join('tmp', 'authored-global-bank-'));

try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const compiled = compileHeapServiceSystem('halt_until_irq', opt, modules);
		const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
		function entry(key: string) {
			const symbol = object.sections.rodata.moduleExports.find(record => record.path === path && record.exportPathKey === key)!;
			const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
			deriveBlua32FixedStack(linked.image, [index]);
			return linked.image.functions[index].address;
		}
		const commit = entry('commit_name'), find = entry('find_name'), growth = entry('growth_capacity');
		const rom = join(dir, `O${opt}.rom`), script = join(dir, 'trace'), initial = join(dir, 'initial'), portable = join(dir, 'partial');
		writeFileSync(rom, linked.romBytes);

		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		const oracle = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		for (const subject of [runtime, oracle]) subject.boot();
		const { cpu, memory, scheduler } = runtime.machine, ram = memory.ramData(), arena = cpu.heapAllocator, management = arena.managementOffset();
		const old = oracle.machine.cpu, oldArena = old.heapAllocator, oldMem = oracle.machine.memory, oldRam = oldMem.ramData();
		const keys = candidates.map(name => {
			const key = cpu.stringPool.intern(name);
			assert.equal(old.stringPool.intern(name), key);
			return key;
		});
		const preexisting = cpu.captureRuntimeState().globals;
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
			observe(`J ${cycles} 1`, `${result} ${paid} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		}
		function finish(result: number) {
			for (let grants = 0; grants < 4096 && cpu.heapServiceActive(); ++grants) grant(37);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.heapServiceResult(), result >>> 0);
		}
		let collided = false;
		for (let i = 0; i < candidates.length; ++i) {
			const key = keys[i], prior = old.captureRuntimeState().globals;
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
			old.setGlobalByKey(key, valueNil());
			oracleObserve(`f ${candidates[i]}`, '0 0');
			const expect = old.captureRuntimeState().globals;
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
			assert.equal(cpu.luaHeap.usedBytes(), old.luaHeap.usedBytes());
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
		const barrierKey = old.stringPool.intern('namespace_pending_name');
		old.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(old.gc.phase(), GcPhase.Mark);
		const markByte = oldMem.readRamRecordByte(barrierKey + 1);
		const prior = old.captureRuntimeState().globals;
		assert.ok(prior.count < prior.capacity);
		for (const [index, word] of [prior.base, prior.capacity, prior.count].entries()) oldMem.writeRamRecordWord(bank + 4 * index, word);
		const markStart = captureRuntimeSaveState(oracle);
		const markPath = join(dir, 'mark');
		writeFileSync(markPath, encodeRuntimeSaveState(markStart));
		applyRuntimeSaveState(runtime, markStart);
		old.setGlobalByKey(barrierKey, valueNil());
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
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
