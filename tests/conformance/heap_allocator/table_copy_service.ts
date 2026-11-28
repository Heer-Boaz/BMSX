import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { TableHeader, TableRecords } from '../../../machine/ts/machine/cpu/table';
import { asInteger, isNil, valueInteger, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, HEAP_PAGE_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';

// Actual Cart -> BIOS table.copy (own values, not a private fixture jump).
// The unrooted member is produced by its own returned frame. On a physical
// refusal the old source requires keeping source alive, but not that member.
const cartSource = `
local source<const> = setmetatable({}, { __mode = 'v' })
for i = 1, 1024 do source[i] = i end
local function write_weak_member(target, depth)
	if depth > 0 then
		write_weak_member(target, depth - 1)
	else
		target.__newindex = { 7 }
	end
end
write_weak_member(source, 2)
source[4] = nil
copy_source = source
local admitted, copy = pcall(table.copy, source)
if not admitted then
	assert(copy == 'Out of memory.')
	return 41
end
copy_result = copy
local okay, message = pcall(table.copy, false)
assert(not okay and message == 'Invalid argument.')
assert(getmetatable(copy) == nil and not rawequal(source, copy))
assert(copy[4] == nil and copy[1024] == 1024)
assert(copy.__newindex == source.__newindex)
copy[1024] = 9
assert(source[1024] == 1024)
return 37
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join('tmp', 'bmsx-table-copy-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { images } = compileCartlibProgram(cartSource, { optLevel });
		const rom = join(directory, `O${optLevel}.rom`), cart = join(directory, `O${optLevel}-cart.rom`);
		writeFileSync(rom, images.systemRomBytes);
		writeFileSync(cart, images.cartRomBytes);
		for (const scenario of ['weak_recovered', 'oom'] as const) {
			const runtime = new Runtime({
				systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			}, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, gc } = nativeHeapReference(cpu);
			const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const systemVector = () => cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_SYSCALL;
			const atCopy = () => systemVector() && cpu.activeThread.frameAtDepth(0).registers.get(0) === valueInteger(0x10020);
			for (let i = 0; i < 200_000 && !atCopy(); ++i) run(23);
			assert.ok(atCopy(), 'public Table copy entered the ordinary System vector');
			const source = valuePayload(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('copy_source')!));
			const member = nativeHeapReference(cpu).stringPool.find('__newindex')!;
			const tables = nativeHeapReference(cpu).gc.tables;
			assert.equal(tables.arrayCapacity(source), 1024);
			assert.ok(!isNil(tables.getStringKey(source, member)));
			assert.equal(memory.readRamRecordByte(source + TableHeader.NewIndexAbsent), 0);
			const owner = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), caller = cpu.rootThread.frameDepth - 1;
			const successor = cpu.readEpcWord();
			const inCopy = () => systemVector() && cpu.readEpcWord() === successor;
			assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), successor);

			// Source is rooted and before the first allocation in the firmware.
			// Occupy *physical* slots; the recovered case frees a real dead
			// backing record, not a simulated failed status or logical quota.
			nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
			if (scenario === 'weak_recovered') createReferenceTable(cpu, 1536, 0);
			while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) {}
			while (arena.allocate(16, true)) {}
			const seed = join(directory, `O${optLevel}-${scenario}.seed`);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const commands: string[] = [], expected: string[] = [];
			const observe = (command: string, outcome: string | number) => { commands.push(command); expected.push(String(outcome)); };
			function grant(cycles: number) {
				const result = run(cycles);
				const used = cycles - cpu.instructionBudgetRemaining;

				observe(`J ${cycles} 1`, `${result} ${used} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
				return result;
			}
			for (let i = 0; i < 8192 && gc.phase() !== GcPhase.Strings; ++i) {
				assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), successor, 'caller cannot execute while assistance is pending');
				assert.ok(inCopy());
				grant(151);
			}
			assert.equal(gc.phase(), GcPhase.Strings);
			assert.ok(isNil(tables.getStringKey(source, member)), 'recovery cleared the source weak entry before copying');
			assert.equal(memory.readRamRecordByte(source + TableHeader.NewIndexAbsent), 1);
			const partial = join(directory, 'partial'), nativePartial = join(directory, 'native-partial');
			const checkpoint = captureRuntimeSaveState(runtime);
			const partialRam = history.capture(memory, baseline);
			writeFileSync(partial, encodeRuntimeSaveState(checkpoint));
			const prefix = commands.length;
			const beforeCopy = nativeHeapReference(cpu).luaHeap.usedBytes();
			function finish() {
				for (let i = 0; i < 8192 && inCopy(); ++i) grant(151);
				assert.equal(inCopy(), false);
				const limit = 8192;
				let result = RunResult.Yielded;
				for (let i = 0; i < 64 && result !== RunResult.Halted; ++i) result = grant(limit);
				assert.equal(result, RunResult.Halted);
				const completion = scenario === 'oom' ? 41 : 37;
				assert.equal(asInteger(runtime.readCompletionValues()[0]), completion);
				observe('C', completion);
				if (scenario !== 'oom') {
					const copy = valuePayload(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('copy_result')!));
					assert.ok(isNil(tables.getStringKey(copy, member)));
					assert.equal(memory.readRamRecordByte(copy + TableHeader.NewIndexAbsent), 1, 'copy carries the proof from after recovery');
					assert.equal(tables.hashSize(copy), tables.hashSize(source));
					assert.equal(tables.arrayCapacity(copy), 1024);
					assert.notEqual(tables.hashAddress(copy), tables.hashAddress(source));
					assert.notEqual(tables.arrayAddress(copy), tables.arrayAddress(source));
					// Even DeadKey/collision link/census lanes are transported as bytes.
					const offset = tables.hashAddress(copy) & RAM_RECORD_WORD_MASK;
					const original = tables.hashAddress(source) & RAM_RECORD_WORD_MASK;
					const length = TableRecords.hashStorageBytes(tables.hashSize(source));
					assert.deepEqual(memory.ramData().subarray(offset, offset + length), memory.ramData().subarray(original, original + length));
					assert.equal(memory.readRamRecordWord(copy + TableHeader.Metatable), 0);
				}
				const start = memory.ramBusEnd() - RAM_BASE, finish = memory.ramData().length;
				observe(`H ${start} ${finish}`, hashBytes(memory.ramData(), start, finish - start));
			}
			finish();
			const all = commands.slice(), outputs = expected.slice();
			const tail = all.slice(prefix), tailOutputs = outputs.slice(prefix);
			function check(name: string, state: string, trace: string[], observed: string[]) {
				const path = join(directory, `${scenario}-${name}.trace`);
				writeFileSync(path, trace.join('\n'));
				const actual = execFileSync(native, [rom, path, state, cart], { encoding: 'utf8' }).trimEnd().split('\n');
				const diff = actual.findIndex((entry, index) => entry !== observed[index]);
				assert.equal(diff, -1, `${scenario} ${name} line ${diff}: TS=${observed[diff]} C++=${actual[diff]}`);
				assert.equal(actual.length, observed.length);
			}
			check('both', seed, ['X', 'l', ...all.slice(0, prefix), 's', `x ${nativePartial}`, ...tail, 'u', ...tail], [...outputs, ...tailOutputs]);
			check('ts-to-cpp', partial, ['X', ...tail], tailOutputs);
			history.restore(memory, history.capture(memory, partialRam), partialRam);
			applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), beforeCopy);
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, tailOutputs);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, tailOutputs);
			console.log(`BIOS-TABLE-COPY:PASS O${optLevel} ${scenario} (${all.length} grant/RAM observations)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
