import { MANAGED_CART_LAUNCH } from '../helpers/managed_cart_launch';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { numberToHost, valueBool, valueInteger } from '../../machine/ts/machine/cpu/value';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { TABLE_CONSTRUCTOR_BINDING } from '../helpers/table_constructor';
import { test } from 'node:test';

import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import type { Memory } from '../../machine/ts/machine/memory/memory';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { CART_ROM_BASE, CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	BLUA32_IMAGE_DATA_ADDRESS_OFFSET, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type CompiledSystemProgram } from '../../toolchain/ts/lua/compiler';
import { readLE32 } from '../../machine/ts/common/endian';
import {
	disassembleTestBlua32Functions,
	linkTestBlua32Pair,
	linkTestCartBlua32,
	linkTestSystemBlua32,
	writeTestBlua32Rom,
} from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../helpers/managed_system';
import type { Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, source);
	return parser.parseChunk();
}

function compileSource(source: string, path = 'section_bss.lua') {
	return compileLuaChunkToProgram(parseSource(source, path), [], {
		entrySource: source,
		programDomain: 'system',
	});
}

function constModule(path: string, source: string) {
	const declaredSource = `module<const>\n${source}`;
	return { path, chunk: parseSource(declaredSource, `${path}.lua`), source: declaredSource };
}

function compileWithConstModule(entrySource: string, modulePath: string, moduleSource: string): CompiledSystemProgram {
	return compileTestSystemWithHeap(
		parseSource(entrySource, 'entry.lua'),
		[constModule(modulePath, moduleSource)],
		{ entrySource, programDomain: 'system' },
	);
}


function disassembleEntryFunction(compiled: CompiledSystemProgram): string {
	const image = linkTestSystemBlua32(compiled);
	return disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
}

const entryBudget = 1_000_000;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
type SectionSystem = ReturnType<typeof linkManagedTestSystem>;

function bootSectionProgram(systemRomBytes: Uint8Array, cartRom?: Uint8Array, cpuExecutionBackend = CpuExecutionBackend.Interpreter) {
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(cartRom),
		machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend }, input);
	runtime.boot();
	assert.equal(runtime.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	return runtime;
}

function sectionAddress(symbols: Blua32SymbolsImage, name: string): number {
	const address = symbols.metadata.staticScopes.declarations.find(declaration => declaration.name === name)?.address;
	assert.ok(address !== undefined, `linked address of ${name}`);
	return address;
}

function runCold(source: string, {
	optLevel = 0, modules = [], poison,
}: {
	optLevel?: 0 | 3;
	modules?: readonly { path: string; source: string }[];
	poison?: (memory: Memory, linked: SectionSystem) => void;
} = {}) {
	const linked = linkManagedTestSystem(source, optLevel, modules);
	const runtime = bootSectionProgram(writeTestBlua32Rom(linked));
	const { cpu, memory } = runtime.machine;
	// Section storage is installed RAM but not yet visible through the public
	// CPU aperture. Set the test sentinels before firmware executes.
	poison?.(memory, linked);
	runGuestToHalt(cpu, entryBudget);
	assert.equal(cpu.getFrameDepth(), 0, 'the System entry retired after the BIOS handoff');
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	return { memory, values: runtime.readCompletionValues(), image: linked.layout, symbols: linked.symbols };
}

test('BLua .bss declarations emit RAM section symbols and cold startup zeroes them as code', () => {
	const source = `
bss counter: word
return *counter, &counter
`;
	const compiled = compileSource(source);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(image.sections.bss.byteCount, 4);
	assert.deepEqual(image.sections.bss.symbols, [{
		name: 'module:section_bss.lua/bss:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.every(reloc => reloc.kind === 'bss_addr'), true);

	const result = runCold(source, { poison: (memory, linked) =>
		memory.writeRamRecordWord(sectionAddress(linked.symbols, 'counter'), 0x11223344) });
	const counter = sectionAddress(result.symbols, 'counter');
	assert.equal(result.memory.readMappedU32LE(counter), 0);
	assert.deepEqual(result.values, [0, counter].map(valueInteger));
});

for (const optLevel of [3] as const) for (const words of [1, 7, 8, 9, 17, 33, 4133]) test(`section initialization clears ${words} BSS words without touching neighbors (O${optLevel})`, () => {
	const source = `data prefix: word = 305419896\nbss scratch: word[${words}]\nreturn *prefix`;
	const { memory, values, image } = runCold(source, { optLevel, poison: (memory, linked) => {
		const { bssAddress, bssByteCount, dataAddress } = linked.layout.header;
		memory.writeRamRecordWord(dataAddress, 0xfeedface);
		for (let offset = 0; offset <= bssByteCount; offset += 4) memory.writeRamRecordWord(bssAddress + offset, 0xfeedface);
	} });
	assert.deepEqual(values, [valueInteger(305419896)]);
	const { bssAddress, bssByteCount } = image.header;
	for (let offset = 0; offset < bssByteCount; offset += 4)
		assert.equal(memory.readMappedU32LE(bssAddress + offset), 0, `BSS byte offset ${offset}`);
	assert.equal(memory.readMappedU32LE(bssAddress + bssByteCount), 0xfeedface);
});

for (const optLevel of [3] as const) for (const byteCount of [1, 3, 31, 32, 33]) test(`section initialization clears aligned byte BSS of ${byteCount} bytes (O${optLevel})`, () => {
	const source = `bss bytes: u8[${byteCount}]\nreturn &bytes`;
	const { memory, values, image, symbols } = runCold(source, { optLevel, poison: (memory, linked) => {
		const { bssAddress, bssByteCount } = linked.layout.header;
		for (let offset = 0; offset <= bssByteCount; offset += 4) memory.writeRamRecordWord(bssAddress + offset, 0xfeedface);
	} });
	assert.deepEqual(values, [valueInteger(sectionAddress(symbols, 'bytes'))]);
	const { bssAddress, bssByteCount } = image.header;
	for (let offset = 0; offset < bssByteCount; offset += 4)
		assert.equal(memory.readMappedU32LE(bssAddress + offset), 0, `BSS byte offset ${offset}`);
	assert.equal(memory.readMappedU32LE(bssAddress + bssByteCount), 0xfeedface);
});

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) test(`system and cartridge each initialize only their own BSS, including after restore (O${optLevel}, backend=${backend})`, () => {
	const launcher = `
bss system_scratch: word[9]
halt_until_irq
system_scratch[0] = 0x12345678
${MANAGED_CART_LAUNCH}`;
	const cartridge = `data prefix: word = 305419896\nbss scratch: word[17]\nreturn *prefix`;
	const system = linkManagedTestSystem(launcher, optLevel);
	const cart = compileLuaChunkToProgram(parseSource(cartridge, 'cart_bss.lua'), [], { entrySource: cartridge, programDomain: 'cart', optLevel });
	const { cartRomBytes, cartImage } = linkTestCartBlua32(system.biosImports, cart);
	const systemRom = writeTestBlua32Rom(system);
	const runtime = bootSectionProgram(systemRom, cartRomBytes, backend);
	const { cpu, memory } = runtime.machine;
	const systemBss = sectionAddress(system.symbols, 'system_scratch');
	const { dataAddress: cartData, bssAddress: cartBss, bssByteCount: cartBssBytes } = cartImage.header;
	const end = cartBss + cartBssBytes;
	for (let address = system.layout.header.bssAddress; address <= end; address += 4)
		memory.writeRamRecordWord(address, 0xfeedface);

	runGuestToHalt(cpu, entryBudget);
	assert.equal(cpu.isHaltedUntilIrq(), true, 'System initialized its BSS and stopped before entering the cartridge');
	assert.equal(cpu.isCartridgeExecutionActive(), false);
	for (let i = 0; i < 9; i++) assert.equal(memory.readMappedU32LE(systemBss + 4 * i), 0);
	for (let address = cartData; address <= end; address += 4)
		assert.equal(memory.readRamRecordWord(address), 0xfeedface, 'System did not initialize the cartridge regions');

	const restored = bootSectionProgram(systemRom, cartRomBytes, backend);
	const saved = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(saved, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	for (const state of [runtime, restored]) {
		const { cpu, memory } = state.machine;
		assert.equal(cpu.isHaltedUntilIrq(), true);
		cpu.clearHaltUntilIrq();
		runGuestToHalt(cpu, entryBudget);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.deepEqual(state.readCompletionValues(), [valueInteger(305419896)]);
		assert.equal(memory.readMappedU32LE(systemBss), 0x12345678, 'cartridge startup did not clear System BSS');
		for (let i = 1; i < 9; i++) assert.equal(memory.readMappedU32LE(systemBss + 4 * i), 0);
		assert.equal(memory.readMappedU32LE(cartData), 305419896);
		for (let i = 0; i < 17; i++) assert.equal(memory.readMappedU32LE(cartBss + 4 * i), 0);
		assert.equal(memory.readMappedU32LE(end), 0xfeedface);
	}
	// State load deliberately requests a fresh VRAM presentation. Compare
	// architectural CPU state and all installed RAM for this section handoff.
	assert.deepEqual(cpu.captureRuntimeState(), restored.machine.cpu.captureRuntimeState());
	assert.equal(Buffer.compare(memory.ramData(), restored.machine.memory.ramData()), 0);
});

test('BLua .bss storage is consumed through typed pointers and struct fields', () => {
	const result = runCold(`
struct actor
	hp: word
	xy: word[2]
end
bss actors: actor[2]
actors[1].hp = 99
actors[1].xy[0] = 12
return actors[1].hp, actors[1].xy[0], &actors[1], sizeof(actor)
`);

	assert.deepEqual(result.values, [99, 12, sectionAddress(result.symbols, 'actors') + 12, 12].map(valueInteger));
});

test('const modules export .bss storage symbols without runtime module state', () => {
	const moduleSource = `
bss counter: word
return { counter = counter }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
*counter = 77
return *counter, state.counter
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.deepEqual(image.sections.bss.symbols, [{
		name: 'module:state/bss:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'bss_addr' && reloc.symbolIndex === 0), true);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, TABLE_CONSTRUCTOR_BINDING);

	const result = runCold(entrySource, { modules: [constModule('state', moduleSource)], poison: (memory, linked) =>
		memory.writeRamRecordWord(sectionAddress(linked.symbols, 'counter'), 0x11223344) });
	const counter = sectionAddress(result.symbols, 'counter');
	assert.deepEqual(result.values, [77, counter].map(valueInteger));
	assert.equal(result.memory.readMappedU32LE(counter), 77);
});

test('const modules export function call targets without runtime module state', () => {
	const moduleSource = `
bss counter: word
local function read()
	return *counter
end
return { counter = counter, read = read }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
*counter = 41
return state.read()
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.match(compiled.metadata.exportProtoIdBySlot.state__read, /\/static:/);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, TABLE_CONSTRUCTOR_BINDING);
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*state__read/);
	assert.equal(image.link.constRelocs.some(
		reloc => reloc.kind === 'export_proto'
			&& reloc.path === 'state'
			&& reloc.exportPathKey === 'read',
	), true);

	const result = runCold(entrySource, { modules: [constModule('state', moduleSource)] });
	assert.deepEqual(result.values, [valueInteger(41)]);
	assert.equal(result.memory.readMappedU32LE(sectionAddress(result.symbols, 'counter')), 41);
});

test('const module function export aliases stay call targets', () => {
	const moduleSource = `
local function read()
	return 1
end
return { read = read }
`;
	const entrySource = 'local state<const> = require("state")\nlocal read<const> = state.read\nreturn read()';
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const disasm = disassembleEntryFunction(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.constRelocs.some(
		reloc => reloc.kind === 'export_proto'
			&& reloc.path === 'state'
			&& reloc.exportPathKey === 'read',
	), true);
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*state__read/);
	assert.deepEqual(runCold(entrySource, { modules: [constModule('state', moduleSource)] }).values, [valueInteger(1)]);
});

test('const module value exports are not lowered as call-target symbols', () => {
	const moduleSource = `
local answer<const> = 7
return { answer = answer }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.answer()', 'state', moduleSource),
		/value export 'answer' is not a call target/,
	);
});

test('const module function call targets cannot capture module locals', () => {
	const moduleSource = `
local value = 7
local function read()
	return value
end
return { read = read }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.read()', 'state', moduleSource),
		/captures runtime local 'value'/,
	);
});

test('const module function call targets use module compile-time constants without captures', () => {
	const moduleSource = `
local tile_size<const> = 8
local function tiles_per_row()
	return 256 // tile_size
end
return { tiles_per_row = tiles_per_row }
`;
	const result = runCold('local state<const> = require("state")\nreturn state.tiles_per_row()',
		{ modules: [constModule('state', moduleSource)] });
	assert.deepEqual(result.values, [32].map(valueInteger));
});

test('const module function call targets call sibling function exports through link symbols', () => {
	const moduleSource = `
bss counter: word
local function increment(value)
	return value + 1
end
local function read_next()
	return increment(*counter)
end
return { counter = counter, increment = increment, read_next = read_next }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
*counter = 40
return state.read_next()
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(image.link.constRelocs.some(
		reloc => reloc.kind === 'export_proto'
			&& reloc.path === 'state'
			&& reloc.exportPathKey === 'increment',
	), true);
	assert.deepEqual(runCold(entrySource, { modules: [constModule('state', moduleSource)] }).values, [valueInteger(41)]);
});

test('const module function call targets reject sibling function exports used as values', () => {
	const moduleSource = `
local function increment(value)
	return value + 1
end
local function leak()
	local fn = increment
	return fn(1)
end
return { increment = increment, leak = leak }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.leak()', 'state', moduleSource),
		/cannot call a dynamic value/,
	);
});

test('const module function call targets reject table allocation opcodes', () => {
	const moduleSource = `
local function make()
	return {}
end
return { make = make }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.make()', 'state', moduleSource),
		/Static function export.*cannot construct a Table/,
	);
});

test('const module function call targets reject table dispatch opcodes', () => {
	const moduleSource = `
local function read(record)
	return record.value
end
return { read = read }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.read({ value = 3 })', 'state', moduleSource),
		/forbidden static opcode GETFIELD \(table dispatch\)/,
	);
});

test('const module function call targets reject built-in table traversal', () => {
	const moduleSource = `
local function count(next, record)
	local entries = 0
	for key in next, record do entries = entries + 1 end
	return entries
end
return { count = count }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.count(1, 2)', 'state', moduleSource),
		/forbidden static opcode ITERN \(table dispatch\)/,
	);
});

test('const module function call targets reject runtime closure allocation opcodes', () => {
	const moduleSource = `
local function outer()
	local function inner() return 1 end
	return inner()
end
return { outer = outer }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.outer()', 'state', moduleSource),
		/forbidden static opcode CLOSURE \(runtime closure allocation\)/,
	);
});

test('const module function call targets reject vararg opcodes', () => {
	const moduleSource = `
local function first(...)
	return ...
end
return { first = first }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.first(1)', 'state', moduleSource),
		/forbidden static opcode VARARG \(vararg dispatch\)/,
	);
});

test('const module function call targets reject dynamic concat opcodes', () => {
	const moduleSource = `
local function suffix(prefix)
	return prefix .. "_x"
end
return { suffix = suffix }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.suffix("a")', 'state', moduleSource),
		/forbidden static opcode CONCAT \(dynamic string concatenation\)/,
	);
});

test('const module function call targets reject Lua object constants', () => {
	const moduleSource = `
local function label()
	return "enemy"
end
return { label = label }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.label()', 'state', moduleSource),
		/forbidden static opcode LOADK \(Lua string constant\)/,
	);
});

test('const module function call targets reject runtime globals', () => {
	const moduleSource = `
local function leaked_global()
	return print
end
return { leaked_global = leaked_global }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.leaked_global()', 'state', moduleSource),
		/forbidden static opcode GET(?:SYS|GL) \(runtime global slot\)/,
	);
});

test('const module function call targets reject dynamic calls', () => {
	const moduleSource = `
local function invoke(fn)
	return fn(1)
end
return { invoke = invoke }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.invoke(function(value) return value end)', 'state', moduleSource),
		/cannot call a dynamic value/,
	);
});

test('const module function call targets reject Lua object length', () => {
	const moduleSource = `
local function count(value)
	return #value
end
return { count = count }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.count("abc")', 'state', moduleSource),
		/forbidden static opcode LEN \(Lua object length\)/,
	);
});

test('const-module function exports remain pack-time link targets', () => {
	const moduleSource = 'local function read() return 1 end\nreturn { read = read }';
	const compiled = compileTestSystemWithHeap(
		parseSource('return require("state").read()', 'entry.lua'),
		[constModule('state', moduleSource)],
		{ entrySource: 'return require("state").read()', programDomain: 'system' },
	);
	assert.equal(compiled.constRelocs.some(
		reloc => reloc.kind === 'export_proto'
			&& reloc.path === 'state'
			&& reloc.exportPathKey === 'read',
	), true);
});

test('multiple const modules reserve distinct .bss storage symbols in one program', () => {
	const entrySource = `
local a<const> = require("state_a")
local b<const> = require("state_b")
local ap<const>: *word = a.counter
local bp<const>: *word = b.counter
*ap = 11
*bp = 22
return *ap, *bp, a.counter, b.counter
`;
	const modules = [
		constModule('state_a', 'bss counter: word\nreturn { counter = counter }'),
		constModule('state_b', 'bss counter: word\nreturn { counter = counter }'),
	];
	const compiled = compileTestSystemWithHeap(parseSource(entrySource, 'entry.lua'), modules,
		{ entrySource, programDomain: 'system' });
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(image.sections.bss.symbols, [
		{ name: 'module:state_a/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:state_b/bss:counter', offset: 4, byteCount: 4, alignment: 4 },
	]);
	const result = runCold(entrySource, { modules });
	const counters = result.symbols.metadata.staticScopes.declarations.filter(declaration => declaration.name === 'counter');
	assert.equal(counters.length, 2);
	const address = counters[0].address!;
	assert.equal(counters[1].address, address + 4);
	assert.deepEqual(result.values, [11, 22, address, address + 4].map(valueInteger));
});

test('linked system and cart const-module .bss symbols resolve against their own VMA bases', () => {
	const systemSource = 'local s<const> = require("sys_state")\nreturn s.counter';
	const systemCompiled = compileTestSystemWithHeap(
		parseSource(systemSource, 'system.lua'),
		[constModule('sys_state', 'bss counter: word\nreturn { counter = counter }')],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = 'local s<const> = require("cart_state")\nreturn s.counter';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[constModule('cart_state', 'bss counter: word\nreturn { counter = counter }')],
		{ entrySource: cartSource },
	);
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	assert.equal(finalized.systemImage.header.bssAddress, DYNAMIC_RAM_BASE);
	assert.equal(finalized.cartImage.header.bssAddress, DYNAMIC_RAM_BASE + 4);
	assert.equal(finalized.systemImage.header.bssByteCount, 4);
	assert.equal(finalized.cartImage.header.bssByteCount, 4);
	assert.deepEqual(encodeCompiledProgramObject(systemCompiled).sections.bss.symbols, [
		{ name: 'module:sys_state/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(encodeCompiledProgramObject(cartCompiled).sections.bss.symbols, [
		{ name: 'module:cart_state/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === DYNAMIC_RAM_BASE,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === DYNAMIC_RAM_BASE + 4,
	), true);
});

test('BLua .data declarations emit initialized RAM symbols and cold startup copies them as code', () => {
	const source = `
data counter: word = 17
return *counter, &counter
`;
	const compiled = compileSource(source, 'section_data.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(Array.from(image.sections.data.bytes), [17, 0, 0, 0]);
	assert.deepEqual(image.sections.data.symbols, [{
		name: 'module:section_data.lua/data:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_addr' && reloc.symbolIndex === 0), true);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_lma_addr' && reloc.symbolIndex === 0), true);

	const result = runCold(source, { poison: (memory, linked) =>
		memory.writeRamRecordWord(sectionAddress(linked.symbols, 'counter'), 0x11223344) });
	const counter = sectionAddress(result.symbols, 'counter');
	assert.deepEqual(result.values, [17, counter].map(valueInteger));
	assert.equal(result.memory.readMappedU32LE(counter), 17);
});

test('BLua static declaration words remain identifiers outside declaration shape', () => {
	const result = runCold(`
local struct = { [0] = 1 }
local bss = { [0] = 2 }
local data = { [0] = 1 }
local rodata = { [0] = 4 }
struct[0] = struct[0] + 1
bss[0] = bss[0] + 1
data[0] = data[0] + 1
rodata[0] = rodata[0] + 1
return struct[0], bss[0], data[0], rodata[0]
`);
	assert.deepEqual(result.values, [2, 3, 2, 5].map(valueInteger));
});

test('BLua .data storage is mutable through typed pointers and shifts .bss after initialized RAM', () => {
	const result = runCold(`
data value: word = 9
bss scratch: word
*scratch = *value + 5
*value = 21
return *value, *scratch, value, scratch
`);
	const value = sectionAddress(result.symbols, 'value');
	const scratch = sectionAddress(result.symbols, 'scratch');
	assert.equal(result.image.header.bssAddress, value + 4);
	assert.ok(scratch >= result.image.header.bssAddress && scratch < result.image.header.bssAddress + result.image.header.bssByteCount);
	assert.deepEqual(result.values, [21, 14, value, scratch].map(valueInteger));
	assert.equal(result.memory.readMappedU32LE(value), 21);
	assert.equal(result.memory.readMappedU32LE(scratch), 14);
});

test('const modules export .data storage symbols without runtime module state', () => {
	const moduleSource = `
data counter: word = 12
return { counter = counter }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
local before = *counter
*counter = 88
return before, *counter, state.counter
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.deepEqual(image.sections.data.symbols, [{
		name: 'module:state/data:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_addr' && reloc.symbolIndex === 0), true);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, TABLE_CONSTRUCTOR_BINDING);
	const result = runCold(entrySource, { modules: [constModule('state', moduleSource)] });
	assert.deepEqual(result.values, [12, 88, sectionAddress(result.symbols, 'counter')].map(valueInteger));
});

test('linked system and cart const-module .data symbols resolve VMA and LMA ranges', () => {
	const systemSource = 'local s<const> = require("sys_data")\nreturn s.value';
	const systemCompiled = compileTestSystemWithHeap(
		parseSource(systemSource, 'system.lua'),
		[constModule('sys_data', 'data value: word = 10\nreturn { value = value }')],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = 'local s<const> = require("cart_data")\nreturn s.value';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[constModule('cart_data', 'data value: word = 20\nreturn { value = value }')],
		{ entrySource: cartSource },
	);
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const systemDataLma = finalized.systemImage.header.dataLoadAddress;
	const cartDataLma = finalized.cartImage.header.dataLoadAddress;
	assert.equal(finalized.systemImage.header.dataAddress, DYNAMIC_RAM_BASE);
	assert.equal(finalized.cartImage.header.dataAddress, DYNAMIC_RAM_BASE + 4);
	assert.equal(finalized.cartImage.header.bssAddress, DYNAMIC_RAM_BASE + 8);
	assert.deepEqual(Array.from(finalized.systemImage.dataLoadBytes), [10, 0, 0, 0]);
	assert.deepEqual(Array.from(finalized.cartImage.dataLoadBytes), [20, 0, 0, 0]);
	assert.deepEqual(encodeCompiledProgramObject(systemCompiled).sections.data.symbols, [
		{ name: 'module:sys_data/data:value', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(encodeCompiledProgramObject(cartCompiled).sections.data.symbols, [
		{ name: 'module:cart_data/data:value', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === DYNAMIC_RAM_BASE,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === DYNAMIC_RAM_BASE + 4,
	), true);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === systemDataLma,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === cartDataLma,
	), true);
});

test('BLua .rodata declarations emit CPU-readable ROM section symbols', () => {
	const source = `
rodata values: word[3] = { 11, 22, 33 }
return values[0], values[1], values[2], values
`;
	const compiled = compileSource(source, 'section_rodata.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:section_rodata.lua/rodata:values',
		offset: 0,
		byteCount: 12,
		alignment: 4,
	}]);
	assert.deepEqual(Array.from(image.sections.rodata.bytes), [11, 0, 0, 0, 22, 0, 0, 0, 33, 0, 0, 0]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'rodata_addr' && reloc.symbolIndex === 0), true);
	const result = runCold(source);
	assert.deepEqual(result.values, [11, 22, 33, result.symbols.metadata.staticScopes.declarations.find(decl => decl.name === 'values')!.address].map(valueInteger));
});

test('BLua .rodata typed storage preserves byte and halfword layout', () => {
	const source = `
rodata bytes: u8[3] = { 1, 2, 3 }
rodata halves: u16[2] = { 258, 772 }
return bytes[0], bytes[1], bytes[2], halves[0], halves[1], bytes, halves
`;
	const compiled = compileSource(source, 'section_rodata_widths.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(Array.from(image.sections.rodata.bytes), [1, 2, 3, 0, 2, 1, 4, 3]);
	assert.deepEqual(image.sections.rodata.symbols, [
		{ name: 'module:section_rodata_widths.lua/rodata:bytes', offset: 0, byteCount: 3, alignment: 1 },
		{ name: 'module:section_rodata_widths.lua/rodata:halves', offset: 4, byteCount: 4, alignment: 2 },
	]);
	const result = runCold(source);
	const bytesAddress = result.symbols.metadata.staticScopes.declarations.find(decl => decl.name === 'bytes')!.address;
	assert.deepEqual(result.values, [1, 2, 3, 258, 772, bytesAddress, bytesAddress + 4].map(valueInteger));
});

for (const section of ['data', 'rodata'] as const) {
	for (const optLevel of [3] as const) {
		test(`O${optLevel}: .${section} floating initializers preserve scalar, array and struct layouts`, () => {
			const source = `
struct floating_record
	tag: u8
	single: f32
	double: f64
end
${section} scalar: f64 = -0.0
${section} singles: f32[3] = { 1 / 3, -0.0, 1 }
${section} doubles: f64[3] = { 1 / 3, -0.0, 1 }
${section} record: floating_record = { tag = 7, single = -1.5, double = 2.25 }
return *scalar, singles[0], singles[1], singles[2],
	doubles[0], doubles[1], doubles[2], record.tag, record.single, record.double
`;
			const compiled = compileTestSystemWithHeap(parseSource(source, 'floating_storage.lua'), [],
				{ entrySource: source, optLevel, programDomain: 'system' });
			const bytes = encodeCompiledProgramObject(compiled).sections[section].bytes;
			assert.deepEqual(Array.from({ length: bytes.length / 4 }, (_, index) => readLE32(bytes, index * 4)), [
				0, 0x80000000,
				0x3eaaaaab, 0x80000000, 0x3f800000,
				0x60000000, 0x3fd55555, 0, 0x80000000, 0, 0x3ff00000,
				7, 0xbfc00000, 0, 0x40020000,
			]);
			assert.deepEqual(runCold(source, { optLevel }).values.map(numberToHost),
				[-0, Math.fround(1 / 3), -0, 1, Math.fround(1 / 3), -0, 1, 7, -1.5, 2.25]);
		});
	}
}

test('integer storage initializers still reject fractional numbers', () => {
	for (const section of ['data', 'rodata']) {
		assert.throws(() => compileSource(`${section} value: word = 1.5`), /must be a compile-time integer/);
	}
});

test('BLua static storage derives dimensions and initializer values from local constants', () => {
	const result = runCold(`
local count<const> = 3
rodata values: word[count] = { count, count + 1, count + 2 }
return #values, values[0], values[1], values[2]
`);
	assert.deepEqual(result.values, [3, 3, 4, 5].map(valueInteger));
});

test('BLua static storage derives dimensions from const-module fields', () => {
	const source = `
local layout<const> = require('layout')
local cell_count<const> = layout.columns * layout.rows
bss cells: word[cell_count]
return #cells
`;
	const moduleSource = `
local columns<const> = 4
local rows<const> = 3
return { columns = columns, rows = rows }
`;
	assert.deepEqual(runCold(source, { modules: [constModule('layout', moduleSource)] }).values, [valueInteger(12)]);
});

test('BLua static storage exposes exported array dimensions to const-module consumers', () => {
	const entrySource = `return require('consumer')`;
	const consumerSource = `
local storage<const> = require('storage')
return #storage.scratch + #storage.values + #storage.labels
`;
	const modules = [
		constModule('storage', `
bss scratch: word[2]
data values: word[3] = { 1, 2, 3 }
rodata labels: string[] = { 'ONE', 'TWO', 'THREE', 'FOUR' }
return {
	scratch = scratch,
	values = values,
	labels = labels,
}
`),
		{ path: 'consumer', source: consumerSource },
	];
	assert.deepEqual(runCold(entrySource, { modules }).values, [valueInteger(9)]);
});

test('BLua .rodata records infer array length and load immutable string fields without tables', () => {
	const source = `
struct monitor_command
	name: string
	usage: string
	kind: u8
end
rodata commands: monitor_command[] = {
	{ name = 'CLS', usage = 'CLS', kind = 1 },
	{ name = 'MEM', usage = 'MEM <HEX ADDRESS> [WORDS]', kind = 2 },
}
return #commands, commands[0].name == 'CLS', #commands[1].usage, commands[1].kind, sizeof(monitor_command)
`;
	const compiled = compileSource(source, 'rodata_records.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(image.link.rodataConstRelocs, [
		{ byteOffset: 0, constIndex: readLE32(image.sections.rodata.bytes, 0) },
		{ byteOffset: 4, constIndex: readLE32(image.sections.rodata.bytes, 4) },
		{ byteOffset: 12, constIndex: readLE32(image.sections.rodata.bytes, 12) },
		{ byteOffset: 16, constIndex: readLE32(image.sections.rodata.bytes, 16) },
	]);
	const disassembly = disassembleEntryFunction(compiled);
	assert.match(disassembly, /LOADKR/);
	assert.doesNotMatch(disassembly, TABLE_CONSTRUCTOR_BINDING);
	assert.deepEqual(runCold(source).values, [valueInteger(2), valueBool(true), valueInteger(25), valueInteger(2), valueInteger(12)]);
});

test('cart linking remaps const references stored in physical cart .rodata', () => {
	const recordSource = (text: string) => `
struct label
	text: string
end
rodata labels: label[] = { { text = '${text}' } }
return labels[0].text
`;
	const systemSource = recordSource('SYSTEM');
	const system = compileTestSystemWithHeap(
		parseSource(systemSource, 'system_rodata_record.lua'),
		[],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = recordSource('CART');
	const cart = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart_rodata_record.lua'),
		[],
		{ entrySource: cartSource, programDomain: 'cart' },
	);
	const finalized = linkTestBlua32Pair(system, cart);
	const systemConstIndex = readLE32(finalized.systemImage.rodataBytes, 0);
	const systemConstant = finalized.systemImage.constants[systemConstIndex];
	assert.equal(systemConstant, 'SYSTEM');
	const cartConstIndex = readLE32(finalized.cartImage.rodataBytes, 0);
	const cartConstant = finalized.cartImage.constants[cartConstIndex];
	assert.equal(cartConstant, 'CART');
});

test('const modules export .rodata storage symbols without runtime module state', () => {
	const moduleSource = `
rodata values: word[2] = { 5, 6 }
return { values = values }
`;
	const entrySource = `
local data<const> = require("data")
local values<const>: *word = data.values
return values[0], values[1], data.values
`;
	const compiled = compileWithConstModule(entrySource, 'data', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('data'), false);
	assert.equal(compiled.staticModulePaths.includes('data'), false);
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:data/rodata:values',
		offset: 0,
		byteCount: 8,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'rodata_addr' && reloc.symbolIndex === 0), true);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, TABLE_CONSTRUCTOR_BINDING);
	const result = runCold(entrySource, { modules: [constModule('data', moduleSource)] });
	assert.deepEqual(result.values, [5, 6, sectionAddress(result.symbols, 'values')].map(valueInteger));
});

test('linked system and cart const-module .rodata symbols resolve against their ROM ranges', () => {
	const systemSource = 'local s<const> = require("sys_data")\nreturn s.values';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[constModule('sys_data', 'rodata values: word[1] = { 10 }\nreturn { values = values }')],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = 'local s<const> = require("cart_data")\nreturn s.values';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[constModule('cart_data', 'rodata values: word[1] = { 20 }\nreturn { values = values }')],
		{ entrySource: cartSource },
	);
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const systemRodataAddr = finalized.systemImage.header.rodataAddress;
	const cartRodataAddr = finalized.cartImage.header.rodataAddress;
	assert.deepEqual(Array.from(finalized.systemImage.rodataBytes), [10, 0, 0, 0]);
	assert.deepEqual(Array.from(finalized.cartImage.rodataBytes), [20, 0, 0, 0]);
	assert.deepEqual(encodeCompiledProgramObject(systemCompiled).sections.rodata.symbols, [
		{ name: 'module:sys_data/rodata:values', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(encodeCompiledProgramObject(cartCompiled).sections.rodata.symbols, [
		{ name: 'module:cart_data/rodata:values', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === systemRodataAddr,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant !== null && typeof constant === 'object' && constant.kind === 'integer' && constant.word === cartRodataAddr,
	), true);
});

test('BLua .rodata storage rejects writes at compile time', () => {
	assert.throws(
		() => compileSource('rodata values: word[1] = { 1 }\nvalues[0] = 2\nreturn values[0]', 'rodata_write.lua'),
		/Cannot assign to \.rodata storage/,
	);
});
