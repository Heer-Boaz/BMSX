import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GlobalBank } from '../../../machine/ts/machine/cpu/global_bank';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET, EXECUTION_IMAGE_BINDING_SIZE, EXECUTION_IMAGE_BINDING_SPAN_OFFSET, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET } from '../../../machine/ts/spec/blua32/execution_domain';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkRawTestBlua32Pair, linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { readNamespaceBank, runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const path = 'kernel/warm_bindings';
const modules = [path, 'kernel/global_bank'].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }));
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const halt = new Uint8Array(4);
writeInstruction(halt, 0, OpCode.HALT, 0, 0, 0);
const raw = { text: halt, functions: [{ firstWord: 0, wordCount: 1 }] };
const fixtures = [
	linkRawTestBlua32Pair(raw, { ...raw, constants: ['old-slot-zero'] }),
	linkRawTestBlua32Pair(raw, { ...raw, constants: ['previous-socket-one', 'previous socket one too'] }),
];
const firstCart = 20, directory = 24, directoryWords = 6;
const nameCharge = 9;
mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'warm-bindings-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const cartPaths = fixtures.map((fixture, slot) => {
		const file = join(dir, `slot${slot}.rom`);
		writeFileSync(file, fixture.cartRomBytes);
		return file;
	});
	for (const opt of [0, 3] as const) {
		const linked = linkTestSystemBlua32(compileHeapServiceSystem("return 'old-system-name'", opt, modules));
		const entries = ['retire_namespaces', 'retire_images'].map(name =>
			linked.symbols.metadata.functionIds.findIndex(id => id.startsWith(`module:${path}/`) && id.endsWith(`|constant|${name}`)));
		assert.ok(entries.every(id => id >= 0));
		const fixed = deriveBlua32FixedStack(linked.image, entries);
		assert.ok(fixed.valueSlots <= HEAP_SERVICE_VALUE_COUNT && fixed.frames <= HEAP_SERVICE_FRAME_COUNT);
		const [retireNamespaces, retireImages] = entries.map(id => linked.image.functions[id].address);
		const rom = join(dir, `O${opt}.rom`), script = join(dir, 'trace'), initial = join(dir, 'initial');
		const tsPartial = join(dir, 'typescript-pause'), cppPartial = join(dir, 'native-pause');
		writeFileSync(rom, linked.romBytes);

		const makeRuntime = () => new Runtime({
			systemRomBytes: linked.romBytes, cartridgeSlots: cartridgeSlots(fixtures[0].cartRomBytes, fixtures[1].cartRomBytes),
			machineModel: PSX_MACHINE_SPEC,
		}, input);
		const runtime = makeRuntime(), oracle = makeRuntime();
		runtime.boot(); oracle.boot();
		const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, luaHeap: heap } = cpu;
		runGuestToHalt(cpu, 300_000);
		const rawRam = memory.ramData(), management = arena.managementOffset();
		const { cpu: old, memory: oldMemory } = oracle.machine, oldRam = oldMemory.ramData();
		const metadata = RAM_BASE + management + HEAP_STRING_METADATA_OFFSET;
		const systemDesc = RAM_BASE + management + 0x1c80, globalDesc = systemDesc + 12;
		const imageDesc = globalDesc + 12;
		const binding = (lane: number) => imageDesc + EXECUTION_IMAGE_BINDING_SIZE * lane;
		const write = (address: number, value: number) => memory.writeRamRecordWord(address, value);
		const read = (address: number) => memory.readRamRecordWord(address);
		const readWords = (base: number, count: number) => Array.from({ length: count }, (_, i) => read(base + 4 * i));

		// Real prior producer layouts, not the live host views of the fixture
		// runtime itself: the idle System code remains attached and checkpointable.
		const banks = ['prior-system', 'prior-global'].map((name, lane) => {
			const descriptor = systemDesc + 12 * lane;
			const bank = new GlobalBank(memory, cpu.gc, descriptor);
			for (let i = 0; i < lane + 2; ++i) bank.registerName(cpu.stringPool.intern(`${name}-${i}`));
			return readNamespaceBank(memory, descriptor);
		});
		const spans = [16, opt === 0 ? 28 : 0, 44];
		const imageBases = spans.map((span, lane) => {
			const base = span === 0 ? 0 : heap.allocateRecord(span, false, 0, 0);
			assert.equal(base !== 0, span !== 0);
			write(binding(lane), base);
			write(binding(lane) + EXECUTION_IMAGE_BINDING_SPAN_OFFSET, span);
			write(binding(lane) + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, base);
			write(binding(lane) + EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET, span >>> 2);
			for (let word = 0; word < span / 4; ++word) write(base + word * 4, 0x7a510000 + 256 * lane + word);
			return base;
		});
		const surviving = heap.allocateRecord(32, false, 0, 0);
		assert.ok(surviving !== 0);
		for (let i = 0; i < 8; ++i) write(surviving + 4 * i, 0x122f0000 + i);
		const lowCanary = systemDesc - 4, highCanary = binding(3);
		write(lowCanary, 0x49faa398); write(highCanary, 0xccda2e34);
		for (const slot of [1, 0] as const) {
			const { stringBucketAddress, stringBucketCount } = fixtures[slot].cartImage.header;
			cpu.stringPool.activateRomTable(slot, stringBucketAddress, stringBucketCount);
		}
		const oldDirectory = readWords(metadata + directory, directoryWords);
		assert.ok(oldDirectory.every(value => value !== 0));
		assert.equal(read(metadata + firstCart), 2);
		const seed = captureRuntimeSaveState(runtime);
		writeFileSync(initial, encodeRuntimeSaveState(seed));
		applyRuntimeSaveState(oracle, seed);
		const initialUsed = heap.usedBytes(), initialPhysical = arena.occupiedBytes();
		const baseLow = Math.min(...banks.map(bank => bank.base), ...imageBases.filter(base => base !== 0), surviving) - RAM_BASE - 16;
		const ranges = [
			[baseLow, management], [management + HEAP_STRING_METADATA_OFFSET, management + 0x600],
			[lowCanary - RAM_BASE, highCanary + 4 - RAM_BASE],
		];
		const observations: string[] = [], commands: string[] = [];
		const note = (command: string, result?: string | number) => {
			commands.push(command);
			if (result !== undefined) observations.push(String(result));
		};
		const hashes = (ram: Uint8Array, append: (command: string, result: number) => void) => {
			for (const [first, end] of ranges) append(`H ${first} ${end}`, hashBytes(ram, first, end - first));
		};
		const match = () => {
			for (const [first, end] of ranges) assert.deepEqual(rawRam.subarray(first, end), oldRam.subarray(first, end));
			assert.equal(read(lowCanary), 0x49faa398);
			assert.equal(read(highCanary), 0xccda2e34);
			assert.deepEqual(readWords(surviving, 8), Array.from({ length: 8 }, (_, i) => 0x122f0000 + i));
		};
		let paidTotal = 0;
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(result, RunResult.Yielded);
			assert.ok(paid > 0);
			paidTotal += paid;
			note(`J ${cycles} 1`, `${result} ${paid} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
		}
		function start(fn: number, args: readonly number[]) {
			assert.ok(cpu.beginHeapService(fn, args));
			note(`B ${fn} ${args.length} ${args.join(' ')}`, 1);
		}
		function until(condition: () => boolean, cycles: number) {
			for (let grants = 0; grants < 4096 && cpu.heapServiceActive() && !condition(); ++grants) grant(cycles);
			assert.ok(condition());
		}
		const finish = () => until(() => !cpu.heapServiceActive(), 37);
		const nativeResult = (trace: string[], checkpoint = initial) => {
			writeFileSync(script, trace.join('\n'));
			return execFileSync(native, [rom, script, checkpoint, ...cartPaths], { encoding: 'utf8' }).trimEnd().split('\n');
		};

		const nativeReference = ['X'], referenceObservations: string[] = [];
		const referenceHash = (command: string, value: number) => { nativeReference.push(command); referenceObservations.push(String(value)); };
		note('X');
		start(retireNamespaces, [management, systemDesc, globalDesc]);
		until(() => heap.usedBytes() === initialUsed - nameCharge * banks[0].count, 1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(read(systemDesc), banks[0].base, 'namespace free and charge precede clearing its descriptor');
		assert.equal(read(globalDesc), banks[1].base, 'System namespace retires first');
		assert.ok(arena.occupiedBytes() < initialPhysical);
		hashes(rawRam, note);
		finish();
		for (const [i] of banks.entries()) new GlobalBank(oldMemory, old.gc, systemDesc + 12 * i).clear();
		assert.equal(heap.usedBytes(), initialUsed - nameCharge * (banks[0].count + banks[1].count));
		assert.deepEqual(readWords(systemDesc, 6), [0, 0, 0, 0, 0, 0]);
		assert.deepEqual(readWords(metadata + directory, directoryWords), oldDirectory, 'namespace phase must not retire String directories');
		match();
		hashes(rawRam, note);
		nativeReference.push(`% g ${systemDesc} ${globalDesc}`);
		hashes(oldRam, referenceHash);

		const imageUsed = heap.usedBytes(), imagePhysical = arena.occupiedBytes();
		start(retireImages, [management, imageDesc]);
		until(() => read(imageDesc) === 0, 1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(heap.usedBytes(), imageUsed, 'detaching the image binding precedes its ledger release');
		assert.equal(arena.occupiedBytes(), imagePhysical, 'detaching the image binding precedes freeing it');
		assert.deepEqual(readWords(metadata + directory, directoryWords), oldDirectory);
		hashes(rawRam, note);
		const history = new RamHistory();
		history.start(memory);
		const historyBaseline = history.capture(memory, null);
		const partial = captureRuntimeCheckpointState(runtime);
		writeFileSync(tsPartial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		note(`x ${cppPartial}`);
		note('l'); note('s');
		const imageSuffix = commands.length, imageObservations = observations.length;

		let expectedUsed = imageUsed;
		for (const [lane, span] of spans.entries()) {
			if (span === 0) continue;
			expectedUsed -= span;
			until(() => heap.usedBytes() === expectedUsed, 1);
			assert.ok(cpu.heapServiceActive());
			assert.equal(read(binding(lane)), 0);
			assert.deepEqual([0, 1, 2].slice(lane + 1).map(i => read(binding(i))), imageBases.slice(lane + 1));
			assert.deepEqual(readWords(metadata + directory, directoryWords), oldDirectory);
		}
		until(() => read(metadata + firstCart) === 0, 1);
		assert.ok(cpu.heapServiceActive());
		assert.deepEqual(readWords(metadata + directory, directoryWords), oldDirectory, 'FIRST_CART retires before the six directory words');
		hashes(rawRam, note);
		for (let i = 0; i < directoryWords; ++i) {
			until(() => read(metadata + directory + 4 * i) === 0, 1);
			assert.deepEqual(readWords(metadata + directory, directoryWords), oldDirectory.map((word, lane) => lane <= i ? 0 : word));
		}
		finish();
		assert.deepEqual(readWords(imageDesc, 12), spans.flatMap(span => [0, span, 0, 0]));
		assert.deepEqual(readWords(metadata + firstCart, 7), Array(7).fill(0));
		assert.equal(heap.usedBytes(), expectedUsed);
		const historyEnd = history.capture(memory, historyBaseline);
		for (const [lane, base] of imageBases.entries()) {
			if (base === 0) continue;
			old.luaHeap.releaseRecord(base, spans[lane]); // The TS native owner clears the old host record after free.
			oldMemory.writeRamRecordWord(binding(lane), 0);
			oldMemory.writeRamRecordWord(binding(lane) + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, 0);
			oldMemory.writeRamRecordWord(binding(lane) + EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET, 0);
		}
		old.stringPool.clearRomTables();
		match();
		hashes(rawRam, note);
		nativeReference.push(`% i ${imageDesc}`);
		hashes(oldRam, referenceHash);
		const suffix = commands.slice(imageSuffix), suffixObservations = observations.slice(imageObservations);
		assert.deepEqual(nativeResult(nativeReference), referenceObservations);
		assert.deepEqual(nativeResult([...commands, 'u', ...suffix]), [...observations, ...suffixObservations]);
		assert.deepEqual(nativeResult(['X', ...suffix], tsPartial), suffixObservations);
		function replaySuffix() {
			commands.length = observations.length = 0;
			for (const command of suffix) {
				const [op, first, second] = command.split(' ');
				if (op === 'J') grant(Number(first));
				else note(command, hashBytes(rawRam, Number(first), Number(second) - Number(first)));
			}
			assert.deepEqual(observations, suffixObservations);
			match();
		}
		history.restore(memory, historyEnd, historyBaseline);
		applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
		replaySuffix();
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppPartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		replaySuffix();
		console.log(`BIOS-WARM-BINDINGS O${opt}: ${fixed.valueSlots} slots, ${fixed.frames} frames; ${paidTotal} paid cycles including replay; old TS/native RAM and paired powered pause/rewind agree`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
