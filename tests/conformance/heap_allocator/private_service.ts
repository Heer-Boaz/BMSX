import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BLUA32_STRING_ROM_ADDRESS_MASK } from '../../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS } from '../../../machine/ts/spec/bmsx/io';
import { CART_MMIO_BASE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// A disjoint arena within private RAM, not a duplicate production execution
// path. Keep the real boot heap and halted mutator's storage out of the oracle.
const FLOOR = 0x80000, LIMIT = 0x90000, STATE = LIMIT + 0x400, END = STATE + 0x200;
const path = 'kernel/dlmalloc';
const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
const probePath = 'test/private_storage';
const probeSource = `module<const>
local peek_word<const> = function(address)
	local word<const>: *u32 = address
	return *word
end
local peek_byte<const> = function(address)
	local byte<const>: *u8 = address
	return *byte
end
local poke_word<const> = function(address, value)
	local word<const>: *u32 = address
	*word = value
end
return { peek_word = peek_word, peek_byte = peek_byte, poke_word = poke_word }
`;
const entrySource = `local allocator<const> = require('${path}')\nlocal probe<const> = require('${probePath}')\nhalt_until_irq`;

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-heap-service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { parallel: '4' });
	for (const optLevel of [0, 3] as const) {
		const { romBytes, image, symbols } = linkTestSystemBlua32(compileLuaChunkToProgram(
			parseLuaChunk(entrySource), [{ path, source, chunk: parseLuaChunk(source, path) },
				{ path: probePath, source: probeSource, chunk: parseLuaChunk(probeSource, probePath) }],
			{ entrySource, programDomain: 'system', optLevel },
		));
		const entries = new Map<string, number>();
		symbols.metadata.functionIds.forEach((id, index) => {
			if (id.startsWith(`module:${path}/`) && id.includes('|constant|bmsx_dlmalloc_'))
				entries.set(id.slice(id.lastIndexOf('|') + '|bmsx_dlmalloc_'.length), index);
		});
		assert.equal(entries.size, 11);
		for (const name of ['peek_word', 'peek_byte', 'poke_word']) {
			const index = symbols.metadata.functionIds.findIndex(id =>
				id.startsWith(`module:${probePath}/`) && id.endsWith(`|constant|${name}`));
			assert.ok(index >= 0);
			entries.set(name, index);
		}
		const stack = deriveBlua32FixedStack(image, [...entries.values()]);
		assert.ok(stack.frames <= HEAP_SERVICE_FRAME_COUNT);
		assert.ok(stack.valueSlots <= HEAP_SERVICE_VALUE_COUNT);

		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const occupied = cpu.heapAllocator.occupiedBytes();
		assert.ok(memory.ramBusEnd() <= RAM_BASE + FLOOR);
		const reference = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, MAIN_RAM_SIZE);
		const arena = reference.bindDlmalloc(STATE);
		const trace: string[] = [], expected: string[] = [];
		const checkpointPath = join(directory, `partial-O${optLevel}.state`);

		function observe(command: string, result: string | number): void {
			trace.push(command);
			expected.push(String(result));
		}
		function begin(op: string, args: readonly number[], admitted = true): void {
			const address = image.functions[entries.get(op)!].address;
			const accepted = cpu.beginHeapService(address, args);
			assert.equal(accepted, admitted);
			observe(`B ${address} ${args.length} ${args.join(' ')}`, +accepted);
		}
		function grant(cycles: number): void {
			assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			assert.equal(cpu.heapAllocator.occupiedBytes(), occupied, 'the ordinary heap does not supply service frames or closures');
			const consumed = cycles - cpu.instructionBudgetRemaining;
			assert.ok(consumed > 0, 'service retires guest instructions rather than host work');
			observe(`G ${cycles}`, `${consumed} ${+cpu.heapServiceActive()} ${cpu.heapServiceResult()}`);
		}
		function finish(result: number): void {
			for (let i = 0; i < 2048 && cpu.heapServiceActive(); ++i) grant(100);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.heapServiceResult(), result);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), callerPc, 'the parked caller does not execute inside service grants');
		}
		function compare(): void {
			assert.equal(Buffer.compare(memory.ramData().subarray(FLOOR, END), reference.ramData().subarray(FLOOR, END)), 0);
			observe(`H ${FLOOR} ${END}`, hashBytes(reference.ramData(), FLOOR, END - FLOOR));
		}
		function unmapped(): void {
			const sequence = memory.readBusFaultSequence();
			assert.equal(memory.readMappedU32LE(RAM_BASE + STATE), 0);
			assert.notEqual(memory.readBusFaultSequence(), sequence);
			observe(`M ${RAM_BASE + STATE}`, '0 1');
		}
		function allocate(bytes: number, object = 0): number {
			const offset = arena.allocate(bytes, object);
			begin('allocate', [STATE, bytes, object]);
			finish(offset);
			compare();
			return offset;
		}

		const depth = cpu.getFrameDepth(), callerPc = cpu.readFramePc(depth - 1);
		observe('P', `${depth} ${callerPc}`);
		// A raw record read can project beneath MMIO without touching
		// its device, and can reach installed RAM beyond the write port.
		const lastWord = RAM_BASE + MAIN_RAM_SIZE - 4;
		const ioFlags = memory.readMappedU32LE(IO_IRQ_FLAGS);
		for (const [address, word] of [[IO_IRQ_FLAGS, 0x9371524a], [lastWord, 0x91348127]]) {
			memory.writeRamRecordWord(address, word);
			trace.push(`W ${address} ${word}`);
			begin('peek_word', [address]);
			finish(word);
			begin('peek_byte', [address + 1]);
			finish((word >>> 8) & 0xff);
		}
		assert.equal(memory.readMappedU32LE(IO_IRQ_FLAGS), ioFlags);
		observe(`M ${IO_IRQ_FLAGS}`, `${ioFlags} 0`);
		const sequence = memory.readBusFaultSequence();
		assert.equal(memory.readMappedU32LE(lastWord), 0);
		assert.notEqual(memory.readBusFaultSequence(), sequence);
		observe(`M ${lastWord}`, '0 1');
		begin('reset', [STATE, FLOOR, LIMIT]);
		arena.reset(FLOOR, LIMIT);
		finish(0);
		compare();
		const first = allocate(2400);
		allocate(64, 1);
		assert.ok(first !== 0);
		const retained = arena.allocationBytes(first) - 4;
		for (let off = 0; off < retained; off += 4) {
			const word = (0x5eeda593 ^ off) >>> 0;
			memory.writeRamRecordWord(RAM_BASE + first + off, word);
			reference.writeRamRecordWord(RAM_BASE + first + off, word);
			trace.push(`W ${RAM_BASE + first + off} ${word}`);
		}
		const dest = arena.resizeBacking(first, 6000);
		assert.ok(dest !== 0 && dest !== first);
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		begin('resize_backing', [STATE, first, 6000]);
		begin('allocate', [STATE, 32, 0], false);
		cpu.requestNonMaskableInterrupt();
		trace.push('N');
		assert.equal(cpu.enterPendingInterrupt(), false);
		observe('I', 0);
		unmapped();
		const frame = runtime.frameLoop.beginFrameState(1000000, 0);
		const before = scheduler.nowCycles;
		assert.equal(runtime.cpuExecution.runInstruction(frame), InstructionStepResult.Executed);
		assert.ok(cpu.heapServiceActive());
		const elapsed = scheduler.nowCycles - before;
		assert.ok(elapsed > 0);
		assert.equal(frame.activeCpuUsedCycles, elapsed, 'service execution advances the console clock');
		observe('T', `${elapsed} ${frame.activeCpuUsedCycles}`);
		assert.throws(() => runtime.rebootSystem(), /Heap service must retire before system boot/);
		assert.equal(scheduler.nowCycles, before + elapsed);
		assert.ok(cpu.heapServiceActive());
		observe('R', 'reset deferred');
		const depthWord = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET + ThreadField.FrameDepth;
		let nested = false;
		for (let i = 0; i < 4096 && memory.readRamRecordWord(RAM_BASE + dest) === 0; ++i) {
			grant(1);
			nested ||= memory.readRamRecordWord(depthWord) > 1;
		}
		assert.ok(nested, 'the pinned context entered another firmware function');
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(RAM_BASE + dest), 0x5eeda593);
		assert.equal(memory.readRamRecordWord(RAM_BASE + dest + retained - 4), 0, 'the backing copy stopped partway through');
		assert.notEqual(memory.readRamRecordWord(RAM_BASE + first - 4) & 2, 0, 'the source has not been freed yet');
		const checkpoint = captureRuntimeSaveState(runtime);
		const partial = history.capture(memory, baseline);
		writeFileSync(checkpointPath, encodeRuntimeSaveState(checkpoint));
		trace.push('S');
		const suffix = trace.length, suffixResults = expected.length;
		finish(dest);
		compare();
		const completed = history.capture(memory, partial);
		const continuation = trace.slice(suffix), results = expected.slice(suffixResults);
		history.restore(memory, completed, partial);
		applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
		trace.push('U');
		const replay = trace.length, replayResults = expected.length;
		finish(dest);
		compare();
		assert.deepEqual(trace.slice(replay), continuation);
		assert.deepEqual(expected.slice(replayResults), results);
		applyRuntimeSaveState(runtime, checkpoint);
		trace.push('U');
		finish(dest);
		compare();
		trace.push('X', ...continuation);
		expected.push(...results);
		observe('P', `${depth} ${callerPc}`);
		assert.equal(cpu.enterPendingInterrupt(), true, 'service completion releases the pending interrupt');
		observe('I', 1);

		const rom = join(directory, `service-O${optLevel}.rom`), commands = join(directory, `service-O${optLevel}.txt`);
		writeFileSync(rom, romBytes);
		writeFileSync(commands, trace.join('\n'));
		const output = execFileSync(native, [rom, commands, checkpointPath], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(output, expected, `native O${optLevel} grants, arena, native restore and TS-to-native restore`);
		const badTrace = join(directory, `refused-O${optLevel}.txt`);
		const restore = captureRuntimeSaveState(runtime);
		for (const [op, args, reason] of [
			['poke_word', [IO_IRQ_FLAGS, 0], /outside its private RAM port/],
			['poke_word', [lastWord, 0], /outside its private RAM port/],
			['poke_word', [SYSTEM_ROM_BASE, 0], /outside its private RAM port/],
			['peek_word', [CART_MMIO_BASE], /outside installed RAM and ROM/],
			['peek_word', [BLUA32_STRING_ROM_ADDRESS_MASK + 1], /outside installed RAM and ROM/],
			['peek_word', [IO_IRQ_FLAGS + 1], /requires an aligned byte or word/],
		] as const) {
			const address = image.functions[entries.get(op)!].address;
			assert.ok(cpu.beginHeapService(address, args));
			assert.throws(() => cpu.runUntilDepth(0, 100), reason);
			applyRuntimeSaveState(runtime, restore);
			writeFileSync(badTrace, `B ${address} ${args.length} ${args.join(' ')}\nG 100\n`);
			const refused = spawnSync(native, [rom, badTrace, checkpointPath], { encoding: 'utf8' });
			assert.equal(refused.status, 1);
			assert.match(refused.stderr, reason);
		}
		console.log(`BIOS-HEAP-SERVICE:PASS O${optLevel} (${expected.length} observations; TS and C++)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
