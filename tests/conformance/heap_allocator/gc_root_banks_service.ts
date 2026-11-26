import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GcRootBank } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_MASK, GC_GRAY_INDEX_BITS } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valueString } from '../../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_ROOT_BANK_SIZE, HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE, HEAP_SERVICE_ROOT_BANKS_OFFSET,
	HEAP_SERVICE_ROOT_PORT_BASE, HEAP_SERVICE_ROOT_PORT_STRIDE, HeapServiceRootBankField, HeapServiceRootPlane } from '../../../machine/ts/spec/bmsx/heap_service';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
const entry = 'fixture_collect()\nreturn 57';
const boot = { path: 'fixture_roots_boot', source: 'fixture_collect = __bmsx_collect_garbage' };
const nameText = 'heap-service-young-global-name';
const valueText = 'heap-service-young-global-value';
const constantText = 'resident-cart-root-matches-a-young-ram-string';
const cartSource = `return '${constantText}'`;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-full-gc_root_banks_service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const path = join(directory, `O${opt}`);
		mkdirSync(path);
		const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource), [], { entrySource: cartSource, optLevel: opt });
		const system = linkTestBlua32Pair(compileHeapServiceSystem(entry, opt, [boot]), cart);
		const rom = join(path, 'system.rom');
		const cartRom = join(path, 'cart.rom');
		writeFileSync(rom, system.systemRomBytes);
		writeFileSync(cartRom, system.cartRomBytes);
		const runtime = new Runtime({ systemRomBytes: system.systemRomBytes, cartridgeSlots: cartridgeSlots(system.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory } = runtime.machine, { gc } = cpu;
		const { heapAllocator: arena } = cpu;
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const metadata = management + HEAP_STRING_METADATA_OFFSET, rootThread = cpu.rootThread.address;
		const rootCursor = () => memory.readRamRecordWord(control + GC_ROOT_CURSOR);
		const epochWork = () => memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK - 4);
		const marked = (id: number) => (memory.readRamRecordByte(id + 1) & 1) === (memory.readRamRecordWord(metadata + 12) & 1);
		const name = cpu.stringPool.intern(nameText), value = cpu.stringPool.intern(valueText);
		cpu.setGlobalByKey(name, valueString(value));
		const constant = cpu.stringPool.intern(constantText);
		for (const id of [name, value, constant]) assert.ok(id >= RAM_BASE);
		assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 0);
		assert.deepEqual(cpu['executionImageForDomain'](0)!.constantStringRoots, [constant]);
		assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 1);

		const driver = new FullGcConformance(runtime, native, path, rom, cartRom);
		driver.launch();
		driver.reach(() => (rootCursor() >>> (GC_GRAY_INDEX_BITS + 1)) === GcRootBank.Globals, 'global bank cursor');
		const globals = management + HEAP_SERVICE_ROOT_BANKS_OFFSET + HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE + HEAP_SERVICE_ROOT_BANK_SIZE;
		const globalSlot = cpu['globalBank'].find(name)!;
		assert.equal(memory.readRamRecordWord(globals + HeapServiceRootBankField.Count), cpu.globalSlotCount);
		assert.equal(memory.readRamRecordWord(memory.readRamRecordWord(globals + HeapServiceRootBankField.Names) + 4 * globalSlot), name);
		assert.equal(memory.readRamRecordWord(memory.readRamRecordWord(globals + HeapServiceRootBankField.Payloads) + 4 * globalSlot), value);
		assert.equal(memory.readRamRecordByte(memory.readRamRecordWord(globals + HeapServiceRootBankField.Tags) + globalSlot), ValueTag.String);
		const constants = globals + (GcRootBank.Cart0Constants - GcRootBank.Globals) * HEAP_SERVICE_ROOT_BANK_SIZE;
		assert.equal(memory.readRamRecordWord(constants + HeapServiceRootBankField.Count), 1);
		assert.equal(memory.readRamRecordWord(constants + HeapServiceRootBankField.Payloads),
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.Cart0Constants * HEAP_SERVICE_ROOT_PORT_STRIDE);

		let cursor = rootCursor(), before = epochWork();
		driver.reach(() => {
			if (marked(name)) return true;
			cursor = rootCursor();
			before = epochWork();
			return false;
		}, 'global Name mark');
		assert.equal(marked(value), false, 'the Name is marked before its Value');
		assert.equal(marked(constant), false);
		assert.equal(rootCursor(), cursor, 'the bank cursor is unchanged during the split store');
		assert.equal(epochWork(), before);
		driver.checkpoint('marked-name', [[name - RAM_BASE, name - RAM_BASE + 4], [control + GC_ROOT_CURSOR, control + GC_ROOT_CURSOR + 4]]);

		const beforeThread = memory.readRamRecordWord(rootThread);
		driver.reach(() => rootCursor() === 0, 'root banks complete');
		assert.ok(marked(value) && marked(constant), 'both the global Value and the actual resident cartridge constant were traced');
		assert.equal(memory.readRamRecordWord(rootThread), beforeThread, 'the cursor clears before marking the physical thread root');
		assert.equal((beforeThread >>> 8) & GC_COLOR_MASK, gc.white());
		driver.checkpoint('cleared-cursor', [[control + GC_ROOT_CURSOR, control + GC_ROOT_CURSOR + 4], [rootThread - RAM_BASE, rootThread - RAM_BASE + 4]]);
		driver.finish(57, () => {
			assert.equal(cpu.getGlobalByKey(name), valueString(value));
			assert.equal(cpu.stringPool.find(constantText), constant);
		});

		console.log(`BIOS-FULL-GC:gc_root_banks_service:PASS O${opt}`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
