import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger, ValueTag } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_RESIDENT, BLUA32_FUNCTION_STATIC } from '../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { loadHeapServiceTestModules } from '../helpers/heap_service_system';

const resetPath = 'kernel/test-reset';
const managedSource = 'module<entry>\nreturn 99';
const resetSource = `
local heap<const> = require('kernel/gc_full')
local ports<const>: *word = ${IO_IRQ_MASK}
*ports = 9
local used = heap.heap_bytes()
return used + 7
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const authored = [
	{ path: 'main', displayPath: 'main.lua', source: managedSource, chunk: parseLuaChunk(managedSource, 'main') },
	{ path: resetPath, displayPath: resetPath + '.lua', source: resetSource, chunk: parseLuaChunk(resetSource, resetPath) },
];
const library = loadHeapServiceTestModules().map(module => ({ ...module, displayPath: module.path + '.lua' }));

for (const optLevel of [0, 3] as const) test('System ROM publishes and runs its authored reset vector before managed startup at O' + optLevel, () => {
	const built = buildBlua32Image({
		domain: 'system', luaModules: [...authored, ...library], generatedLuaModules: [], loadAddress: 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
		resetModule: resetPath, preloadModules: HEAP_SERVICE_MODULES, biosExports: [],
	});
	const linked = built.linked, rom = writeTestBlua32Rom(linked);
	const startup = linked.layout.functions[linked.symbols.metadata.functionDisplayNames.indexOf('startup')];
	const reset = linked.layout.functions[linked.functionProtoIndices.indexOf(built.object.vectors.resetProtoIndex)];
	assert.ok(startup && reset && startup.address !== reset.address);
	assert.equal(reset.flags & BLUA32_FUNCTION_STATIC, BLUA32_FUNCTION_STATIC);
	assert.equal(reset.flags & BLUA32_FUNCTION_RESIDENT, 0);
	assert.equal(linked.symbols.metadata.functionIds[linked.symbols.metadata.functionDisplayNames.indexOf('reset')].endsWith('/reset'), true);
	assert.equal(readLE32(rom, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET), reset.address);
	assert.equal(linked.symbols.metadata.preloadModules.includes(resetPath), false);
	assert.equal(built.object.sections.rodata.staticModulePaths.includes(resetPath), false);
	assert.equal(built.object.sections.rodata.moduleProtos.some(module => module.path === resetPath), false);
	const firstManaged = decodeBlua32InstructionAtPc(linked.layout.textBytes, linked.layout.header.textAddress, startup.codeAddress);
	assert.equal(firstManaged.op, OpCode.CLOSURE);
	assert.equal(firstManaged.bx * BLUA32_FUNCTION_ALIGNMENT,
		linked.layout.functions[linked.functionProtoIndices.indexOf(built.object.vectors.sectionInitProtoIndex)].address);

	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const used = cpu.luaHeap.usedBytes();
	const grant = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
	assert.equal(cpu.readFramePc(0), reset.codeAddress);
	assert.equal(scheduler.nowCycles, 0);
	assert.equal(memory.readMappedWord(IO_IRQ_MASK), 0);
	const retired: OpCode[] = [];
	for (let step = 0; step < 32 && !cpu.heapServiceActive(); ++step) {
		const pc = cpu.readFramePc(0);
		assert.ok(pc >= reset.codeAddress && pc < reset.codeAddress + reset.codeByteCount);
		const instruction = decodeBlua32InstructionAtPc(linked.layout.textBytes, linked.layout.header.textAddress, pc);
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[instruction.op]); // no arguments or secret CPU boot action
		retired.push(instruction.op);
		if (instruction.op === OpCode.CLOSURE) {
			assert.equal(cpu.activeThread.currentFrame!.registers.getTag(instruction.a), ValueTag.ResidentFunction);
		}
	}
	assert.ok(retired.includes(OpCode.STORE_MEM) || retired.includes(OpCode.STORE_MEM_D));
	assert.equal(retired[retired.length - 1], OpCode.CALL);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(memory.readMappedWord(IO_IRQ_MASK), 9);
	assert.equal(cpu.luaHeap.usedBytes(), used);
	for (let step = 0; step < 16 && cpu.getFrameDepth() !== 0; ++step) grant(1024);
	assert.equal(cpu.heapServiceActive(), false);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(used + 7)]);
	assert.equal(cpu.luaHeap.usedBytes(), used);
});

test('a source selected as reset cannot also be initialized as an ordinary module', () => {
	const source = 'return 37';
	const module = { path: resetPath, source, chunk: parseLuaChunk(source, resetPath) };
	assert.throws(() => compileLuaChunkToProgram(authored[0].chunk, [module], {
		programDomain: 'system', entrySource: managedSource, resetModule: resetPath, preloadModules: [resetPath],
	}), /cannot be initialized as an ordinary module/);
	const ordinary = compileLuaChunkToProgram(authored[0].chunk, [], { programDomain: 'system', entrySource: managedSource });
	assert.equal(encodeCompiledProgramObject(ordinary).vectors.resetProtoIndex, ordinary.startupProtoIndex);
});
