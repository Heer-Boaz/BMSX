import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem, residentFunctionAddress } from '../../helpers/heap_service_system';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_COLOR_MASK } from '../../../toolchain/ts/firmware/stock_object_layout';
import { ValueTag, valueString } from '../../../machine/ts/machine/cpu/value';
import { GLOBAL_BANK_OFFSET, GlobalBankField } from '../../../machine/ts/spec/blua32/execution_domain';
import { GC_ROOT_BANK_SIZE, GC_ROOT_BANKS_HEADER_SIZE, GC_ROOT_BANKS_OFFSET, GcRootBankField, HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GcRootBank } from '../../helpers/native_heap/gc_heap';
const entry = 'fixture_collect()\nreturn 57';
const boot = { path: 'fixture_roots_boot', source: "local heap<const> = require('kernel/gc_full'); fixture_collect = function() heap.collect_full() end" };
const nameText = 'heap-service-young-global-name';
const valueText = 'heap-service-young-global-value';
const constantTexts = ['resident-cart-root-matches-a-young-ram-string', 'second-young-resident-cart-root'];
const cartSource = `return 'ROM before roots', '${constantTexts[0]}', 'ROM between roots', '${constantTexts[1]}', 'ROM after roots'`;

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
		const { cpu, memory } = runtime.machine, { gc } = nativeHeapReference(cpu);
		const { heapAllocator: arena } = nativeHeapReference(cpu);
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const metadata = management + HEAP_STRING_METADATA_OFFSET, rootThread = cpu.rootThread.address;
		const rootCursor = () => memory.readRamRecordWord(control + GC_ROOT_CURSOR);
		const epochWork = () => memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK - 4);
		const marked = (id: number) => (memory.readRamRecordByte(id + 1) & 1) === (memory.readRamRecordWord(metadata + 12) & 1);
		const name = nativeHeapReference(cpu).stringPool.intern(nameText), value = nativeHeapReference(cpu).stringPool.intern(valueText);
		setReferenceGlobal(cpu, name, valueString(value));
		const constants = constantTexts.map(text => nativeHeapReference(cpu).stringPool.intern(text));
		for (const id of [name, value, ...constants]) assert.ok(id >= RAM_BASE);
		assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 0);
		const image = cpu['executionImageForDomain'](0)!;
		assert.deepEqual(constants.map((_, i) => memory.readRamRecordWord(image.constantStringBase + 4 * i)), constants);
		assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), constants.length);

		const driver = new FullGcConformance(runtime, native, path, rom, residentFunctionAddress({ image: system.systemImage, symbols: system.systemSymbols }, 'kernel/gc_full', 'collect_full'), cartRom);
		driver.launch();
		const globals = management + GLOBAL_BANK_OFFSET;
		driver.reach(() => rootCursor() !== 0, 'root scan admitted');
		const globalSlot = cpu['globalBank'].find(name)!;
		const globalValues = memory.readRamRecordWord(globals + GlobalBankField.Values);
		const capacity = memory.readRamRecordWord(globals + GlobalBankField.Capacity);
		assert.equal(memory.readRamRecordWord(globals + GlobalBankField.Count), cpu.globalSlotCount);
		assert.equal(memory.readRamRecordWord(globalValues - 12 * capacity + 4 * globalSlot), name);
		assert.equal(memory.readRamRecordWord(globalValues + 4 * globalSlot), value);
		assert.equal(memory.readRamRecordByte(globalValues + 4 * capacity + globalSlot), ValueTag.String);
		const constantBank = management + GC_ROOT_BANKS_OFFSET + GC_ROOT_BANKS_HEADER_SIZE
			+ (GcRootBank.Cart0Constants - GcRootBank.SystemConstants) * GC_ROOT_BANK_SIZE;
		assert.equal(memory.readRamRecordWord(constantBank + GcRootBankField.Count), constants.length);
		assert.equal(memory.readRamRecordWord(constantBank + GcRootBankField.Payloads),
			image.constantStringBase);

		let cursor = rootCursor(), before = epochWork();
		driver.reach(() => {
			if (marked(name)) return true;
			cursor = rootCursor();
			before = epochWork();
			return false;
		}, 'global Name mark');
		assert.equal(marked(value), false, 'the Name is marked before its Value');
		assert.equal(constants.some(marked), false);
		assert.equal(rootCursor(), cursor, 'the bank cursor is unchanged during the split store');
		assert.equal(epochWork(), before);
		driver.checkpoint('marked-name', [[name - RAM_BASE, name - RAM_BASE + 4], [control + GC_ROOT_CURSOR, control + GC_ROOT_CURSOR + 4]]);

		driver.reach(() => marked(constants[0]), 'first compact Constant mark');
		assert.equal(marked(constants[1]), false, 'RAM String roots retain their original constant-ordinal order');
		const binding = image.constantStringBase - RAM_BASE;
		driver.checkpoint('marked-first-constant', [[binding, binding + 4 * image.constantStringSlots.length],
			[constants[0] - RAM_BASE, constants[0] - RAM_BASE + 4]]);

		const beforeThread = memory.readRamRecordWord(rootThread);
		driver.reach(() => rootCursor() === 0, 'root banks complete');
		assert.ok(marked(value) && constants.every(marked), 'both the global Value and the actual resident cartridge constant were traced');
		assert.equal(memory.readRamRecordWord(rootThread), beforeThread, 'the cursor clears before marking the physical thread root');
		assert.equal((beforeThread >>> 8) & GC_COLOR_MASK, gc.white());
		driver.checkpoint('cleared-cursor', [[control + GC_ROOT_CURSOR, control + GC_ROOT_CURSOR + 4], [rootThread - RAM_BASE, rootThread - RAM_BASE + 4]]);
		driver.finish(57, () => {
			assert.equal(cpu.getGlobalByKey(name), valueString(value));
			assert.deepEqual(constantTexts.map(text => nativeHeapReference(cpu).stringPool.find(text)), constants);
		});

		console.log(`BIOS-FULL-GC:gc_root_banks_service:PASS O${opt}`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
