import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import { CpuRunKind } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger, ValueTag } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT, BLUA32_FUNCTION_STATIC } from '../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { CPU_RESET_BANK_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const resetPath = 'kernel/test-reset', irqPath = 'kernel/test-irq', exceptionPath = 'kernel/test-exception';
const managedSource = 'module<entry>\nreturn 99';
const resetSource = `
local child<const> = function()
	halt_until_irq
	local port<const>: *word = ${IO_IRQ_MASK}
	return *port + 7
end
local port<const>: *word = ${IO_IRQ_MASK}
*port = ${IRQ_VBLANK | 8}
local word<const> = child()
return word
`;
const irqSource = `
local ack<const>: *word = ${IO_IRQ_ACK}
*ack = ${IRQ_VBLANK}
`;
const exceptionSource = 'halt_until_irq';
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const authored = [
	{ path: 'main', displayPath: 'main.lua', source: managedSource, chunk: parseLuaChunk(managedSource, 'main') },
	{ path: resetPath, displayPath: resetPath + '.lua', source: resetSource, chunk: parseLuaChunk(resetSource, resetPath) },
	{ path: irqPath, displayPath: irqPath + '.lua', source: irqSource, chunk: parseLuaChunk(irqSource, irqPath) },
	{ path: exceptionPath, displayPath: exceptionPath + '.lua', source: exceptionSource, chunk: parseLuaChunk(exceptionSource, exceptionPath) },
];

for (const optLevel of [0, 3] as const) test('System ROM publishes and runs its authored reset vector before managed startup at O' + optLevel, () => {
	const built = buildBlua32Image({
		domain: 'system', luaModules: authored, generatedLuaModules: [], loadAddress: 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
		resetModule: resetPath, irqModule: irqPath, exceptionModule: exceptionPath, biosExports: [],
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
	const assertRaw = () => {
		assert.equal(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		assert.equal(cpu.heapServiceActive(), false);
	};
	assertRaw();
	assert.equal(cpu.readFramePc(0), reset.codeAddress);
	assert.equal(scheduler.nowCycles, 0);
	assert.equal(memory.readMappedWord(IO_IRQ_MASK), 0);
	const retired: OpCode[] = [];
	const step = () => {
		const frame = cpu.activeThread.currentFrame!;
		const instruction = decodeBlua32InstructionAtPc(linked.layout.textBytes, linked.layout.header.textAddress, frame.pc);
		scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[instruction.op] + (instruction.op === OpCode.RET ? instruction.b - 1 : 0));
		retired.push(instruction.op);
		if (instruction.op === OpCode.CLOSURE) {
			const fn = linked.layout.functions.find(body => body.address === instruction.bx * BLUA32_FUNCTION_ALIGNMENT)!;
			assert.equal(readLE32(rom, fn.address + BLUA32_FUNCTION_FLAGS_OFFSET) & (BLUA32_FUNCTION_CODE | BLUA32_FUNCTION_RESIDENT), BLUA32_FUNCTION_CODE);
			assert.equal(frame.registers.getTag(instruction.a), ValueTag.CodeFunction);
		}
		assertRaw();
	};
	for (let i = 0; i < 32 && !cpu.isHaltedUntilIrq(); ++i) step();
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.getFrameDepth(), 2, 'HALT belongs to an ordinary callee on the raw bank');
	assert.ok(retired.includes(OpCode.STORE_MEM) || retired.includes(OpCode.STORE_MEM_D));
	assert.ok(retired.includes(OpCode.CALL));
	assert.equal(memory.readMappedWord(IO_IRQ_MASK), IRQ_VBLANK | 8);

	const continuation = cpu.readFramePc(1);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.getFrameDepth(), 3);
	assert.equal(cpu.readEpcWord(), continuation);
	assert.equal(cpu.isExceptionFrame(2), true);
	for (let i = 0; i < 32 && cpu.getFrameDepth() === 3; ++i) step();
	assert.equal(cpu.getFrameDepth(), 2);
	assert.equal(cpu.readFramePc(1), continuation);
	assert.equal(runtime.machine.irqController.enabledPendingFlags(), 0);
	for (let i = 0; i < 32 && cpu.getFrameDepth() !== 0; ++i) step();
	assert.equal(cpu.getFrameDepth(), 0);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger((IRQ_VBLANK | 8) + 7)]);
	assertRaw();
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

test('an authored interrupt vector is not callable as a module initializer and has no result tuple', () => {
	const path = 'fixture/irq', source = 'return';
	const module = { path, source, chunk: parseLuaChunk(source, path) };
	assert.throws(() => compileLuaChunkToProgram(authored[0].chunk, [module], {
		programDomain: 'system', entrySource: managedSource, irqModule: path, preloadModules: [path],
	}), /interrupt module .* cannot be initialized as an ordinary module/);
	const returning = { path, source: 'return 7', chunk: parseLuaChunk('return 7', path) };
	assert.throws(() => compileLuaChunkToProgram(authored[0].chunk, [returning], {
		programDomain: 'system', entrySource: managedSource, irqModule: path,
	}), /interrupt vector cannot return values/);
});

test('a fixed User IRQ cannot leave its bank via ordinary RET or HALT', () => {
	const path = 'fixture/user-irq';
	const link = (body: string) => {
		const source = `module<const>\nlocal vector<const> = function() ${body} end\nreturn { vector = vector }`;
		const module = { path, source, displayPath: path + '.lua', chunk: parseLuaChunk(source, path) };
		return buildBlua32Image({
			domain: 'system', luaModules: [...authored, module], generatedLuaModules: [], loadAddress: 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel: 0, traceStatements: 'erase',
			resetModule: resetPath, irqModule: irqPath, exceptionModule: exceptionPath, biosExports: [],
			userIrqEntry: { path, exportPathKey: 'vector' },
		});
	};
	assert.throws(() => link('return'), /exception vector ends with RFE or an exception transfer/);
	assert.throws(() => link('halt_until_irq'), /HALT requires an ordinary interruptible frame/);
});
