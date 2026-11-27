import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes, hashText } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../../machine/ts/machine/cpu/errors';
import { GC_WORK_WORD_CYCLES, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_STRING_METADATA_OFFSET, HEAP_STRING_MARK_WORK_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueNil, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { HEAP_SERVICE_RESULT_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkRawTestBlua32Pair, linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { internStringSliceReference } from '../../helpers/string_slice_reference';

const probe = { path: 'test/intern_probe', source: `module<const>
local intern<const> = require('kernel/allocate_string_slice')
local run<const> = function(management, source, first, len, grant, system, cart0, cart1)
 local id<const>, fault<const> = intern.intern_slice(management, source, first, len, grant, system, cart0, cart1)
 -- Valid String IDs are aligned, including socket-tagged addresses. Encode
 -- only the differential fixture's internal fault outcome in these bits.
 return id | fault
end
return { run = run }` };
const modules = ['kernel/string_slice', 'kernel/allocate_string_slice'].map(path => ({
	path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
}));
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const halt = new Uint8Array(4);
writeInstruction(halt, 0, OpCode.HALT, 0, 0, 0);
const raw = { text: halt, functions: [{ firstWord: 0, wordCount: 1 }] };
const cartFixtures = [
	linkRawTestBlua32Pair(raw, { ...raw, constants: ['socket-0', 'socket-dupe', 'system-slot', 'invalid-header', 'truncated-body'] }),
	linkRawTestBlua32Pair(raw, { ...raw, constants: ['socket-1', 'socket-dupe', 'system-slot'] }),
];
const cartridgeId = (slot: 0 | 1, constant: number, rom = cartFixtures[slot].cartRomBytes) =>
	(readLE32(rom, cartFixtures[slot].cartImage.header.constantTableAddress - CART_ROM_BASE + BLUA32_CONSTANT_RECORD_SIZE * constant
		+ BLUA32_CONSTANT_PAYLOAD_OFFSET) | (slot << 31)) >>> 0;
const buckets = 0, capacity = 4, used = 8, romTables = 24;
const directory = mkdtempSync(join('tmp', 'bmsx-intern-reference-'));
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
try {
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem("return 'system-slot', '##first-intern'", optLevel, [...modules, probe]));
		const entry = system.symbols.metadata.functionIds.findIndex(id => id.startsWith('module:test/intern_probe/') && id.endsWith('|constant|run'));
		assert.ok(entry >= 0);
		const fixed = deriveBlua32FixedStack(system.image, [entry]);
		assert.ok(fixed.valueSlots <= CPU_FIXED_VALUE_COUNT && fixed.frames <= CPU_FIXED_FRAME_COUNT);
		const fn = system.image.functions[entry].address;
		console.log(`BIOS-INTERN O${optLevel}: ${fixed.valueSlots} fixed Value slots, ${fixed.frames} frames`);
		const rom = join(directory, 'system.rom');
		writeFileSync(rom, system.romBytes);

		for (const scenario of [
			'ram-priority', 'system-priority', 'socket-priority', 'socket-fallback',
			'first-directory', 'cart-source', 'growth', 'sweep-suppress-growth', 'logical-assist', 'physical-assist', 'retry', 'oom',
			'invalid-chain', 'invalid-header', 'truncated-payload',
		] as const) {
			const cart0 = cartFixtures[0].cartRomBytes.slice();
			const cart1 = cartFixtures[1].cartRomBytes;
			if (scenario === 'invalid-chain') {
				const id = cartridgeId(0, 3, cart0), { stringBucketAddress, stringBucketCount } = cartFixtures[0].cartImage.header;
				writeLE32(cart0, id - CART_ROM_BASE + BLUA32_STRING_NEXT_OFFSET, id);
				writeLE32(cart0, stringBucketAddress - CART_ROM_BASE + 4 * (hashText('chain-loop test') & (stringBucketCount - 1)), id);
			}
			if (scenario === 'invalid-header')
				writeLE32(cart0, cartridgeId(0, 3, cart0) - CART_ROM_BASE, 0);
			if (scenario === 'truncated-payload') {
				const id = cartridgeId(0, 4, cart0), { stringBucketAddress, stringBucketCount } = cartFixtures[0].cartImage.header, key = 'truncated-body';
				const length = 32, hash = hashText(key.repeat(4).slice(0, length));
				const truncated = (cart0.length - 16) & ~7;
				cart0.copyWithin(truncated, id - CART_ROM_BASE, id - CART_ROM_BASE + 16);
				writeLE32(cart0, truncated + BLUA32_STRING_HASH_OFFSET, hash);
				writeLE32(cart0, truncated + BLUA32_STRING_LENGTH_OFFSET, length);
				writeLE32(cart0, stringBucketAddress - CART_ROM_BASE + 4 * (hash & (stringBucketCount - 1)), CART_ROM_BASE + truncated);
			}
			const files = [join(directory, 's0.rom'), join(directory, 's1.rom')];
			for (const [slot, bytes] of [cart0, cart1].entries()) writeFileSync(files[slot], bytes);
			const makeRuntime = () => new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(cart0, cart1), machineModel: PSX_MACHINE_SPEC }, input);
			const runtime = makeRuntime();
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, stringPool: pool, gc } = nativeHeapReference(cpu);
			runGuestToHalt(cpu, 300_000);
			const [systemId, firstId] = runtime.readCompletionValues().map(valuePayload);
			const management = arena.managementOffset(), metadata = management + HEAP_STRING_METADATA_OFFSET;
			let target = 0;
			if (scenario === 'ram-priority') {
				const address = memory.readRamRecordWord(metadata + romTables);
				const extent = memory.readRamRecordWord(metadata + romTables + 4);
				memory.writeRamRecordPair(metadata + romTables, 0, 0);
				target = pool.intern('system-slot');
				memory.writeRamRecordPair(metadata + romTables, address, extent);
			}
			const text = scenario === 'ram-priority' || scenario === 'system-priority' ? 'system-slot' :
				scenario === 'socket-priority' ? 'socket-dupe' : scenario === 'socket-fallback' ? 'socket-0' :
				scenario === 'first-directory' ? 'first-intern' : scenario === 'cart-source' ? 'cket-du' : scenario === 'invalid-chain' ? 'chain-loop test' : scenario === 'invalid-header' ? 'invalid-header' :
				scenario === 'truncated-payload' ? 'truncated-body'.repeat(4).slice(0, 32) :
				scenario === 'retry' || scenario === 'oom' ? 'borrowed\0\xfe during physical reuse;'.repeat(52) : 'borrowed\0\xfe payload';
			const source = scenario === 'first-directory' ? firstId : scenario === 'cart-source' ? cartridgeId(1, 1) : pool.intern('##' + text + '!!');
			for (const slot of [1, 0] as const) {
				const { stringBucketAddress, stringBucketCount } = cartFixtures[slot].cartImage.header;
				pool.activateRomTable(slot, stringBucketAddress, stringBucketCount);
			}
			if (scenario === 'first-directory') {
				// The isolated allocator fixture starts an empty RAM directory; the
				// borrowed source and its canonical image binding are in System ROM.
				memory.writeRamRecordPair(metadata + buckets, 0, 0);
				memory.writeRamRecordWord(metadata + used, 0);
			}
			if (scenario === 'growth' || scenario === 'sweep-suppress-growth') {
				const count = memory.readRamRecordWord(metadata + capacity);
				for (let i = 0; memory.readRamRecordWord(metadata + used) < count; ++i) pool.intern('pre-grow-' + i);
				assert.equal(memory.readRamRecordWord(metadata + capacity), count);
				if (scenario === 'sweep-suppress-growth') pool.beginSweep();
			}
			const victim = 'garbage providing a contiguous physical run;'.repeat(768);
			if (scenario === 'retry' || scenario === 'oom') {
				if (scenario === 'retry') pool.intern(victim);
				for (let bytes = MAIN_RAM_SIZE >> 1; bytes >= 1024; bytes >>= 1)
					while (arena.allocate(bytes, true)) { /* saturate physical runs, not the quota */ }
				assert.equal(arena.allocate(BLUA32_STRING_RECORD_HEADER_SIZE + text.length, true), 0);
			}
			nativeHeapReference(cpu).luaHeap.setCollectionTarget(scenario === 'logical-assist' ? cpu.luaHeap.usedBytes() : cpu.luaHeap.capacity());
			const policyCycles = scenario === 'logical-assist' || scenario === 'physical-assist' ? 4096 : 0;
			const request = BLUA32_STRING_RECORD_HEADER_SIZE + text.length;
			if (scenario === 'logical-assist') {
				const debt = nativeHeapReference(cpu).luaHeap.allocationDebt(request);
				assert.ok(debt > 0);
				assert.ok(nativeHeapReference(cpu).luaHeap.logicalAssistAllowance(debt, nativeHeapReference(cpu).luaHeap.logicalAssistPressure(request)) * GC_WORK_WORD_CYCLES <= policyCycles);
			}
			if (scenario === 'physical-assist') {
				// Start the original collector's real pacing window. Grow the arena
				// with an issued backing block, not manufactured pace or quota words.
				gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
				assert.equal(gc.phase(), GcPhase.Mark);
				assert.equal(gc.reservationAssistAllowance(request), null);
				let growth = 2 * request;
				while (growth < arena.capacityBytes() && gc.reservationAssistAllowance(growth) === null) growth *= 2;
				assert.ok(growth + arena.occupiedBytes() < arena.capacityBytes());
				assert.notEqual(arena.allocate(growth, true), 0);
				assert.equal(nativeHeapReference(cpu).luaHeap.allocationDebt(request), 0);
				const allowance = gc.reservationAssistAllowance(request);
				assert.ok(allowance !== null && allowance > 0 && allowance * GC_WORK_WORD_CYCLES <= policyCycles);
			}
			const initial = captureRuntimeSaveState(runtime), seed = join(directory, 'seed');
			writeFileSync(seed, encodeRuntimeSaveState(initial));
			const knownFault = scenario === 'invalid-chain' ? 1 : scenario === 'invalid-header' ? 2 : scenario === 'truncated-payload' ? 3 : 0;
			const oracle = makeRuntime();
			oracle.boot();
			applyRuntimeSaveState(oracle, initial);
			// Native reference calls StringPool in Idle (no host quantum clamp).
			// Both assist fixtures explicitly fit within the supplied BLua policy allowance.
			let reference = 0;
			try { reference = internStringSliceReference(nativeHeapReference(oracle.machine.cpu).stringPool, source, 2, text.length); }
			catch (error) {
				if (knownFault) {
					assert.match((error as Error).message, knownFault === 1 ? /String chain is invalid/ : knownFault === 2 ? /String header is invalid/ : /String is truncated/);
					reference = knownFault;
				} else assert.equal(error, LUA_OUT_OF_MEMORY_SIGNAL);
			}
			if (scenario === 'ram-priority') assert.equal(reference, target);
			if (scenario === 'system-priority') assert.equal(reference, systemId);
			if (scenario === 'socket-priority') assert.equal(reference, cartridgeId(1, 1));
			if (scenario === 'socket-fallback') assert.equal(reference, cartridgeId(0, 0));
			if (scenario === 'oom') assert.equal(reference, 0);
			else assert.notEqual(reference, 0);

			const commands: string[] = [], expected: string[] = [];
			const observe = (command: string, output: string | number) => { commands.push(command); expected.push(String(output)); };
			const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const grant = (cycles: number) => {
				const state = run(cycles);
				assert.equal(state, RunResult.Yielded);
				const paid = cycles - cpu.instructionBudgetRemaining;
				assert.ok(paid > 0);
				observe(`J ${cycles} 1`, [state, paid, 0, arena.occupiedBytes(), cpu.luaHeap.usedBytes()].join(' '));
			};
			const trace = join(directory, 'observations');
			const reproduce = (label: string, commands: readonly string[], expected: readonly string[], state = seed) => {
				writeFileSync(trace, commands.join('\n'));
				const actual = execFileSync(native, [rom, trace, state, ...files], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = actual.findIndex((row, index) => row !== expected[index]);
				assert.equal(mismatch, -1, `${scenario} ${label} observation ${mismatch}: TS=${expected[mismatch]} C++=${actual[mismatch]}`);
				assert.equal(actual.length, expected.length, label);
			};
			const ranges = [[memory.ramBusEnd() - RAM_BASE, management],
				[metadata, management + HEAP_STRING_MARK_WORK_OFFSET + 4]] as const;
			const recordRaw = memory.ramData();
			const oracleRaw = oracle.machine.memory.ramData();
			const stateHash = (label: string, compareOracle: boolean) => {
				for (const [start, end] of ranges) {
					if (compareOracle) {
						const firstDifference = recordRaw.subarray(start, end).findIndex((byte, index) => byte !== oracleRaw[start + index]);
						assert.equal(firstDifference, -1, `${scenario} ${label}: first reference RAM difference at ${(start + firstDifference).toString(16)}`);
					}
					observe(`H ${start} ${end}`, hashBytes(recordRaw, start, end - start));
				}
			};
			const command = `= ${source} 2 ${text.length}`;
			const starts = [management, source, 2, text.length, policyCycles, system.romBytes.length, cart0.length, cart1.length];
			assert.ok(cpu.beginHeapService(fn, starts));
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const begin = [`B ${fn} ${starts.length} ${starts.join(' ')}`, 'l'];
			const originalSource = pool.bytes(source);
			const originalWhite = gc.white();
			const checkpoints = scenario === 'growth' || scenario === 'retry';
			if (scenario === 'growth') {
				const logical = cpu.luaHeap.usedBytes(), hash = hashText(text);
				for (let i = 0; i < 4096 && cpu.luaHeap.usedBytes() === logical; ++i) grant(47);
				assert.equal(cpu.luaHeap.usedBytes(), logical + BLUA32_STRING_RECORD_HEADER_SIZE + text.length);
				for (let i = 0; i < 256 && memory.readRamRecordWord(reference + BLUA32_STRING_HASH_OFFSET) !== hash; ++i) grant(1);
				assert.equal(memory.readRamRecordWord(reference + BLUA32_STRING_HASH_OFFSET), hash);
				assert.equal(pool.find(text), undefined, 'partial String header is not a published directory link');
			} else if (scenario === 'logical-assist' || scenario === 'physical-assist') {
				const initialWork = gc.epochWork(), originalOccupancy = arena.occupiedBytes(), originalUsed = cpu.luaHeap.usedBytes();
				for (let i = 0; i < 32768 && cpu.heapServiceActive() && gc.epochWork() === initialWork; ++i) grant(1);
				assert.ok(gc.epochWork() > initialWork, `${scenario}: collector must run before reservation`);
				assert.equal(arena.occupiedBytes(), originalOccupancy, 'collector ran before any reservation');
				assert.equal(cpu.luaHeap.usedBytes(), originalUsed);
			} else if (scenario === 'retry') {
				assert.equal(gc.phase(), GcPhase.Pause);
				for (let i = 0; i < 4096 && gc.phase() < GcPhase.MarkAgain; ++i) grant(113);
				assert.ok(gc.phase() >= GcPhase.MarkAgain);
				assert.equal(pool.find(text), undefined, 'actual allocation refused and the collector owns the live borrow');
				assert.equal(pool.bytes(source), originalSource);
			}
			assert.ok(cpu.heapServiceActive());
			const mid = captureRuntimeSaveState(runtime), midRam = history.capture(memory, baseline);
			const partial = join(directory, 'mid'), cppPartial = join(directory, 'cpp-mid');
			if (checkpoints) stateHash('mid', false);
			writeFileSync(partial, encodeRuntimeSaveState(mid));
			const split = commands.length;
			function finish() {
				const cycles = scenario === 'invalid-chain' ? 4096 : 257;
				for (let i = 0; cpu.heapServiceActive() && i < 8192; ++i) grant(cycles);
				assert.equal(cpu.heapServiceResult(), reference);
				const result = management + HEAP_SERVICE_RESULT_OFFSET;
				observe(`H ${result} ${result + 4}`, hashBytes(recordRaw, result, 4));
				assert.equal(pool.bytes(source), originalSource);
				if (scenario === 'retry') {
					assert.equal(gc.white(), originalWhite ^ 1);
					assert.equal(pool.find(victim), undefined);
				}
				if (reference > 7) assert.equal(pool.bytes(reference), text);
				stateHash('final', true);
			}
			finish();
			const prefix = commands.slice(0, split), prefixRows = expected.slice(0, split);
			const tail = commands.slice(split), tailRows = expected.slice(split);
			reproduce('native reference', ['X', command, ...tail.slice(-ranges.length)], [String(reference), ...tailRows.slice(-ranges.length)]);
			if (checkpoints) {
				reproduce('same BLua grants', ['X', ...begin, ...prefix, 's', `x ${cppPartial}`, ...tail, 'u', ...tail],
					['1', ...prefixRows, ...tailRows, ...tailRows]);
				reproduce('portable TS to native', ['X', ...tail], tailRows, partial);
				history.restore(memory, history.capture(memory, midRam), midRam);
				applyRuntimeCheckpointState(runtime, mid, RuntimeRestoreOrigin.HistorySeek);
				commands.length = expected.length = 0;
				finish();
				assert.deepEqual(expected, tailRows);
				applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppPartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
				commands.length = expected.length = 0;
				finish();
				assert.deepEqual(expected, tailRows);
			} else reproduce('same BLua grants', ['X', ...begin, ...prefix, ...tail], ['1', ...prefixRows, ...tailRows]);
			console.log(`BIOS-INTERN:PASS O${optLevel} ${scenario} same native/TS address and allocator bytes; ${prefix.length + tail.length} BLua grant/state observations`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`String intern evidence: ${directory}`);
	throw error;
}
