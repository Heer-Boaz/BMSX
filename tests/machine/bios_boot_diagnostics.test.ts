import { GC_DIAGNOSTIC_OFFSET, GcDiagnosticField } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { resetAllocatorReference } from '../helpers/heap_allocator_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { GC_DIAGNOSTIC_FAULTS_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../helpers/firmware_heap_layout';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const entrySource = 'halt_until_irq';
const paths = ['kernel/heap_bootstrap', 'kernel/string_slice', 'kernel/boot_diagnostics'];
const modules = paths.map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const basis = 'b8fd922892acf5a776f4a69164d779d6f9b6bec9';
const cpuSource = execFileSync('git', ['show', basis + ':machine/ts/machine/cpu/cpu.ts'], { encoding: 'utf8' });
const constructor = cpuSource.slice(cpuSource.indexOf("this.indexKey = this.stringPool.intern('__index')"), cpuSource.indexOf('// CPU reset keeps the boot-interned records'));
const startupTexts = [...constructor.matchAll(/stringPool\.intern\((['"])(.+?)\1\)/g)].map(match => match[2]);
assert.equal(startupTexts.length, 17);

test('cold boot diagnostic creation and publication pin both original owners', () => {
	verifyPinnedBluaSource('machine/bios/kernel/boot_diagnostics.lua', basis, {
		T: ['machine/ts/machine/cpu/cpu.ts', '72c08041ee82d51e1ff4a2a8e364b17ec1fe9858fcd0e1c1dc4076d127e24036'],
		C: ['machine/cpp/machine/cpu/cpu.cpp', 'ec6b0d4ba3de41ed5ed72e4c576f5e431265378ebcf7996a4b1ecb605186d0eb'],
		G: ['machine/cpp/machine/cpu/gc_heap.cpp', '0badf98ed9e0706b03190d6531f201ac47276f0a858b25020a1177ac2e68f4c0'],
		F: ['machine/ts/spec/blua32/image_format.ts', 'c60839f38c8ef13b57310c84d576da48d127715b8b2cb6b2aed3ea69a5559cf5'],
		S: ['machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
		R: ['machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
		P: ['machine/ts/spec/bmsx/heap_service.ts', 'c6c5e0878c6739aff48f0071d7c0cc13450a9e0b752a265889139a64d1cc525b'],
		Q: ['machine/ts/spec/blua32/cop0.ts', '87510e6e2325f1923a2d37d6d8b6ae0e45e36589d5615506f098fefb3513c4f1'],
	}, [
		['T', 445, 448], ['T', 455, 467], ['T', 471, 478], ['C', 96, 96], ['C', 101, 112],
		['C', 116, 122], ['G', 20, 20], ['F', 48, 50], ['P', 104, 105], ['Q', 34, 46],
	]);
});

for (const optLevel of [0, 3] as const) {
	test(`System boots original RAM diagnostic Strings before its ROM directory at O${optLevel}`, () => {
		const program = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
		const linked = linkTestSystemBlua32(program), object = encodeCompiledProgramObject(program);
		function fn(path: string, name: string): number {
			const entry = object.sections.rodata.moduleExports.find(e => e.path === path && e.exportPathKey === name)!;
			return linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[entry.slotName]);
		}
		const init = fn(paths[0], 'initialize_heap'), diag = fn(paths[2], 'initialize_diagnostics');
		const bounds = deriveBlua32FixedStack(linked.image, [init, diag]);
		console.log(`boot diagnostic O${optLevel} bound: ${bounds.frames} frames, ${bounds.valueSlots} Values including initializer`);
		assert.ok(bounds.frames <= 11 && bounds.valueSlots <= 172, `${bounds.frames} frames/${bounds.valueSlots} Value slots`);

		function machine() {
			const memory = new Memory({ systemRom: linked.romBytes, cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
			return new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
		}
		const cpu = machine(), oracle = machine(), { memory } = cpu, { heapAllocator: arena } = nativeHeapReference(cpu);
		cpu.reset(); // maps immutable instructions so the test can enter from the existing fixed fixture
		const management = arena.managementOffset(), metadata = management + HEAP_STRING_METADATA_OFFSET;
		const constantAddress = readLE32(linked.romBytes, linked.image.address + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
		const read = (offset: number) => memory.readRamRecordWord(offset);
		const head = management + GC_DIAGNOSTIC_OFFSET, faults = management + GC_DIAGNOSTIC_FAULTS_OFFSET;
		const nativeFaults = oracle.memory.ramData().slice(faults, faults + 13 * 4);
		const nativeIds = startupTexts.map(text => nativeHeapReference(oracle).stringPool.find(text)!);
		assert.ok(nativeIds.every(id => id >= RAM_BASE));
		// Independent C/WASM allocator and TS StringPool with the exact original
		// bytes, not restored arena metadata or injected addresses.
		resetAllocatorReference(oracle.memory, nativeHeapReference(oracle).heapAllocator, DYNAMIC_RAM_BASE);
		nativeHeapReference(oracle).luaHeap.setCollectionTarget(1024 * 1024);
		assert.deepEqual(startupTexts.map(text => nativeHeapReference(oracle).stringPool.intern(text)), nativeIds);

		const start = (index: number, args: number[]) => assert.ok(cpu.beginHeapService(linked.image.functions[index].address, args));
		const grant = (cycles: number) => {
			assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
			return cycles - cpu.instructionBudgetRemaining;
		};
		function finish() {
			let paid = 0;
			for (let i = 0; i < 32768 && cpu.heapServiceActive(); ++i) paid += grant(257);
			assert.ok(!cpu.heapServiceActive());
			assert.equal(cpu.heapServiceResult(), 0);
			return paid;
		}
		start(init, [management, DYNAMIC_RAM_BASE - RAM_BASE]);
		finish();
		assert.equal(arena.occupiedBytes(), 0);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), 0);
		for (let address = head + 4; address <= head + GcDiagnosticField.FaultIds; address += 4)
			memory.writeRamRecordWord(address, 0);
		memory.ramData().fill(0, faults, faults + 13 * 4);
		start(diag, [management, constantAddress]);
		for (let i = 0; i < 4096 && nativeHeapReference(cpu).luaHeap.usedBytes() < 200; ++i) grant(31);
		assert.ok(cpu.heapServiceActive());
		assert.ok(nativeHeapReference(cpu).luaHeap.usedBytes() >= 200);
		assert.equal(read(head + GcDiagnosticField.FaultIds), 0, 'no diagnostic root was published before the last allocation');
		const stopped = captureCpuCheckpoint(cpu);
		function compare() {
			assert.equal(arena.occupiedBytes(), 976);
			assert.equal(arena.occupiedBytes(), nativeHeapReference(oracle).heapAllocator.occupiedBytes());
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), 697);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(oracle).luaHeap.usedBytes());
			assert.deepEqual(startupTexts.map(text => nativeHeapReference(cpu).stringPool.find(text)), nativeIds);
			assert.deepEqual(memory.ramData().subarray(faults, faults + 13 * 4), nativeFaults);
			assert.deepEqual([GcDiagnosticField.Index, GcDiagnosticField.NewIndex, GcDiagnosticField.Length,
				GcDiagnosticField.Mode, GcDiagnosticField.Error].map(f => read(head + f)), nativeIds.slice(0, 5));
			assert.equal(read(head + GcDiagnosticField.FaultIds), RAM_BASE + faults);
			assert.deepEqual(memory.ramData().subarray(metadata, management + 0x5b0),
				oracle.memory.ramData().subarray(metadata, management + 0x5b0), 'directory resize/frontier and allocator bins');
			const sameEnd = management - 4096 + arena.occupiedBytes() + 8;
			assert.deepEqual(memory.ramData().subarray(management - 4096, sameEnd), oracle.memory.ramData().subarray(management - 4096, sameEnd));
		}
		const paid = finish();
		compare();
		restoreCpuCheckpoint(cpu, stopped);
		assert.equal(finish(), paid);
		compare();
	});
}
