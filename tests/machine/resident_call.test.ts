import { MANAGED_CART_LAUNCH } from '../helpers/managed_cart_launch';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBool, valueInteger, valuePayload, valueTag, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { hashBytes } from '../../machine/ts/common/hash';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_MANAGEMENT_ADDRESS } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, MAIN_RAM_SIZE, RUNTIME_MANAGEMENT_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { linkSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const probePath = 'private/resident_probe';
const port = RAM_BASE + MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE + 0x100;
const probeSource = `module<const>
local echo<const> = function(input)
 local management<const>: *u32 = ${HEAP_SERVICE_MANAGEMENT_ADDRESS}
 local result<const>: *u32 = ${RAM_BASE} + *management + 0x100
 local step = 89
 repeat
  step = step + 1
  *result = step
 until step == 173
 return true, input
end
return echo`;
const source = `local entry<const> = require('${probePath}')
return function(input)
 local flag, same = entry(input)
 return flag, same
end`;

for (const opt of [0, 3] as const) {
	test(`ordinary CALL enters fixed, private firmware under physical exhaustion (O${opt})`, () => {
	const compiled = compileHeapServiceSystem(MANAGED_CART_LAUNCH, opt, [{ path: probePath, source: probeSource }]);
	const object = encodeCompiledProgramObject(compiled);
	const linked = linkSystemBlua32Image(object, compiled.metadata, SYSTEM_ROM_BASE + 0x100,
		PSX_MACHINE_SPEC.ramBytes, [{ path: probePath, exportPathKey: '', fixedStack: true }]);
	const systemRom = writeTestBlua32Rom(linked);
	const record = linked.biosImports.functions[0].functionAddress - SYSTEM_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET;
	assert.notEqual(readLE32(systemRom, record) & BLUA32_FUNCTION_RESIDENT, 0);
	const cartSource = 'module<entry>\n' + source;
	const cartridge = buildBlua32Image({
		domain: 'cart',
		luaModules: [{ path: 'entry', displayPath: 'entry.lua', source: cartSource, chunk: parseLuaChunk(cartSource, 'entry') }],
		generatedLuaModules: [],
		loadAddress: CART_ROM_BASE + 0x100, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel: opt, traceStatements: 'erase',
		biosImports: linked.biosImports,
	});
	const cartRom = writeTestBlua32Rom(cartridge.linked);
	const cartFunction = cartridge.linked.layout.functions.find(fn => fn.numParams === 1)!;
	const untrustedFlags = cartFunction.address - CART_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET;
	writeLE32(cartRom, untrustedFlags, readLE32(cartRom, untrustedFlags) | BLUA32_FUNCTION_RESIDENT);
	const runtime = new Runtime({ systemRomBytes: systemRom, cartridgeSlots: cartridgeSlots(cartRom), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	runGuestToHalt(cpu, 65536);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.equal(valueTag(values[0]), ValueTag.Closure, 'the RESIDENT bit in cartridge ROM gives no resident entry');
	const caller = valuePayload(values[0]);
	cpu.beginCompletionCall(caller, [valueInteger(-123456)]);
	const arena = cpu.heapAllocator;
	while (arena.allocate(4088, true)) { /* exhaust complete pages */ }
	while (arena.allocate(8, true)) { /* exhaust remaining chunks */ }
	const before = arena.occupiedBytes();
	assert.equal(memory.readRamRecordWord(port), 0);
		const seed = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const trace = ['X'], want: string[] = [];
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Direct);
		trace.push(`J ${cycles} 0`);
		want.push([result, cycles - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(), 0, arena.occupiedBytes(), cpu.luaHeap.usedBytes()].join(' '));
		return result;
	}
	assert.equal(grant(65536), RunResult.Yielded);
	assert.ok(cpu.heapServiceActive());
	assert.equal(memory.readRamRecordWord(port), 0, 'normal CALL parked before the resident store');
	assert.equal(arena.occupiedBytes(), before, 'CLOSURE and CALL made no managed reservation');
	const state = captureCpuCheckpoint(cpu);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), false);
	restoreCpuCheckpoint(cpu, state);
	for (let pass = 0; pass < 2; ++pass) {
		if (pass) restoreCpuCheckpoint(cpu, state);
		runGuestToHalt(cpu, 8192);
		assert.equal(memory.readRamRecordWord(port), 173);
		assert.equal(arena.occupiedBytes(), before);
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueBool(true), valueInteger(-123456)]);
	}
	restoreCpuCheckpoint(cpu, state);
	for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(grant(1024), RunResult.Halted);
	trace.push(`H ${port - RAM_BASE} ${port - RAM_BASE + 4}`, 'c');
	want.push(String(hashBytes(memory.ramData(), port - RAM_BASE, 4)), '2 2 0 3 4294843840');
	const runner = process.env.BMSX_RESIDENT_NATIVE;
	if (runner !== undefined) {
		const dir = mkdtempSync(join(process.cwd(), 'tmp', 'resident-'));
		const system = join(dir, 'system.rom'), cart = join(dir, 'cart.rom'), state = join(dir, 'seed.state'), commands = join(dir, 'trace');
		writeFileSync(system, systemRom);
		writeFileSync(cart, cartRom);
		writeFileSync(state, seed);
		writeFileSync(commands, trace.join('\n'));
		const actual = execFileSync(runner, [system, commands, state, cart], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(actual, want);
		writeFileSync(commands, ['X', 'J 65536 0', 'J 8192 0', 'n', 'J 8192 0', 'c'].join('\n'));
		const native = execFileSync(runner, [system, commands, state, cart], { encoding: 'utf8' }).trimEnd().split('\n');
		const [kind, entries, paid] = native[2].split(' ');
		assert.equal(kind, 'native-firmware');
		assert.ok(+entries > 0 && +paid > 0);
		assert.equal(native[4], want.at(-1));
	}
	});
}

test('resident export publication verifies the relocated instruction stream', () => {
	const system = compileHeapServiceSystem('halt_until_irq', 3, [{ path: probePath, source: probeSource }]);
	const object = encodeCompiledProgramObject(system);
	const slot = object.sections.rodata.moduleExports.find(e => e.path === probePath && e.exportPathKey === '')!.slotName;
	const id = object.link.symbols.exportProtoIdBySlot[slot];
	const proto = object.sections.text.protos[object.link.symbols.protoIds.indexOf(id)];
	writeInstruction(object.sections.text.code, proto.entryPC / INSTRUCTION_BYTES, OpCode.HALT, 0, 0, 0);
	assert.throws(() => linkSystemBlua32Image(
		object, system.metadata, SYSTEM_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes,
		[{ path: probePath, exportPathKey: '', fixedStack: true }],
	), /Fixed-stack.*not in the fixed-stack scalar instruction set/);
});
