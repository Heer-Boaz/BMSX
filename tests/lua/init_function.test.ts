import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
} from '../../machine/ts/spec/bmsx/rom_header';
import { BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { ProgramModule } from '../../toolchain/ts/lua/compiler/passes/module_contract';
import {
	createTestSystemCpu,
	createTestBlua32PairCpu,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
} from '../helpers/blua32';
import {
	materializeCpuCompletionValues,
	parseLuaChunk,
} from './cpu_test_harness';

const compileSystem = (
	entrySource: string,
	moduleSources: ReadonlyArray<{ path: string; source: string }> = [],
) => {
	const modules: ProgramModule[] = moduleSources.map(module => ({
		path: module.path,
		source: module.source,
		chunk: parseLuaChunk(module.source, `${module.path}.lua`),
	}));
	return compileLuaChunkToProgram(
		parseLuaChunk(entrySource, 'entry.lua'),
		modules,
		{ entrySource, programDomain: 'system' },
	);
};

test('init annotations have no cold semantics and tooling invokes modules in dependency order', () => {
	const entrySource = [
		'trace = 0',
		'local a<const> = require("a")',
		'local captured = 4',
		'local function entry_init<init>() trace = trace * 10 + captured end',
		'return trace',
	].join('\n');
	const compiled = compileSystem(entrySource, [
		{
			path: 'a',
			source: [
				'local b<const> = require("b")',
				'local captured = 2',
				'local function a_first<init>() trace = trace * 10 + captured end',
				'local captured_second = 3',
				'local function a_second<init>() trace = trace * 10 + captured_second end',
				'return {}',
			].join('\n'),
		},
		{
			path: 'b',
			source: [
				'local captured = 1',
				'local function b_init<init>() trace = (trace or 0) * 10 + captured end',
				'return {}',
			].join('\n'),
		},
	]);

	assert.deepEqual(compiled.staticModulePaths, ['b', 'a']);
	assert.deepEqual(
		compiled.metadata.initParticipants.map(participant => participant.functionId),
		[
			'module:b/module/local:b_init',
			'module:a/module/local:a_first',
			'module:a/module/local:a_second',
			'module:entry.lua/entry/local:entry_init',
		],
	);
	assert.equal(compiled.metadata.initParticipants.every(participant => participant.system), true);
	for (let index = 0; index < compiled.metadata.initParticipants.length; index += 1) {
		const participant = compiled.metadata.initParticipants[index];
		assert.equal(compiled.metadata.systemGlobalNames.includes(participant.slotName), true);
		assert.equal(compiled.metadata.globalNames.includes(participant.slotName), false);
	}

	const image = linkTestSystemBlua32(compiled);
	assert.notEqual(image.vectors.initFunctionAddress, 0);
	assert.equal(image.image.header.initFunctionAddress, image.vectors.initFunctionAddress);
	assert.deepEqual(image.symbols.initParticipants, compiled.metadata.initParticipants);
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('trace')), 0);

	cpu.beginCompletionCallInExecutionDomain(
		SYSTEM_EXECUTION_DOMAIN_ID,
		image.vectors.initFunctionAddress,
	);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('trace')), 1234);
});

test('init participant slots follow the compiled program domain', () => {
	const source = 'local function refresh<init>() end';
	const system = compileSystem(source);
	const cart = compileLuaChunkToProgram(
		parseLuaChunk(source, 'cart.lua'),
		[],
		{ entrySource: source, programDomain: 'cart' },
	);
	const systemParticipant = system.metadata.initParticipants[0];
	const cartParticipant = cart.metadata.initParticipants[0];
	assert.equal(systemParticipant.system, true);
	assert.equal(system.metadata.systemGlobalNames.includes(systemParticipant.slotName), true);
	assert.equal(system.metadata.globalNames.includes(systemParticipant.slotName), false);
	assert.equal(cartParticipant.system, false);
	assert.equal(cart.metadata.globalNames.includes(cartParticipant.slotName), true);
	assert.equal(cart.metadata.systemGlobalNames.includes(cartParticipant.slotName), false);
});

test('an explicit source init call runs once cold and the tooling vector invokes it again', () => {
	const source = [
		'local calls = 0',
		'local function init<init>() calls = calls + 1 marker = calls return 99 end',
		'local value = init()',
		'return marker, value',
	].join('\n');
	const compiled = compileSystem(source);
	const image = linkTestSystemBlua32(compiled);
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1, 99]);

	cpu.beginCompletionCallInExecutionDomain(
		SYSTEM_EXECUTION_DOMAIN_ID,
		image.vectors.initFunctionAddress,
	);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('marker')), 2);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [null], 'preparation returns exactly one nil, not the participant result');
});

for (const optLevel of [0, 3] as const) {
	for (const domain of ['system', 'cart'] as const) test(`guest invokes its public init sequence and retains storage (${domain}, O${optLevel})`, () => {
		const romBase = domain === 'system' ? 0 : CART_ROM_BASE;
		const source = `data carried: word = 7
bss runs: word
local captured = 4
local function prepare<init>()
    *carried = *carried + captured
    captured = captured + 1
    *runs = *runs + 1
    return 99, 100
end
local image<const> = ${romBase} + mem[${romBase + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET}]
local initialize<const> = blua32.closure(mem[image + ${BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET}])
local cold<const> = *carried == 7 and *runs == 0
local result = initialize()
local first<const> = *carried == 11 and *runs == 1 and result == nil
initialize()
return cold and first, *carried == 16 and *runs == 2 and captured == 6`;
		const chunk = parseLuaChunk(source, 'entry.lua');
		const compiled = domain === 'system'
			? compileLuaChunkToProgram(chunk, [], { entrySource: source, programDomain: 'system', optLevel })
			: compileLuaChunkToProgram(chunk, [], { entrySource: source, programDomain: 'cart', optLevel });
		let machine: ReturnType<typeof createTestSystemCpu>;
		if (compiled.domain === 'system') {
			const image = linkTestSystemBlua32(compiled);
			machine = createTestSystemCpu({
				romBytes: image.romBytes.subarray(0, image.image.address + image.image.bytes.byteLength),
			});
		} else {
			const boot = compileSystem(`cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`);
			const image = linkTestBlua32Pair(boot, compiled);
			machine = createTestBlua32PairCpu({
				systemRomBytes: image.systemRomBytes.subarray(0, image.systemImage.address + image.systemImage.bytes.byteLength),
				cartRomBytes: image.cartRomBytes.subarray(0, image.cartImage.address - CART_ROM_BASE + image.cartImage.bytes.byteLength),
			});
		}
		assert.equal(machine.cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(machine.cpu), [true, true]);
	});
}

test('module initialization alone publishes a callable public preparation sequence', () => {
	const compiled = compileSystem('local dependency<const> = require("dependency")\nreturn dependency', [{
		path: 'dependency', source: 'constructed = (constructed or 0) + 1\nreturn 7',
	}]);
	assert.deepEqual(compiled.metadata.initParticipants, []);
	const image = linkTestSystemBlua32(compiled);
	assert.notEqual(image.image.header.initFunctionAddress, 0);
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [7]);
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, image.image.header.initFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [null]);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('constructed')), 1);
});

test('cart init vector invokes retained cart-global closures', () => {
	const systemSource = [
		'function irq() end',
		'function exception() end',
		`cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`,
	].join('\n');
	const cartSource = [
		'local captured = 2',
		'local function refresh<init>() value = (value or 0) + captured end',
		'refresh()',
		'return value',
	].join('\n');
	const system = compileSystem(systemSource);
	const cart = compileLuaChunkToProgram(
		parseLuaChunk(cartSource, 'cart.lua'),
		[],
		{ entrySource: cartSource, programDomain: 'cart' },
	);
	const image = linkTestBlua32Pair(system, cart);
	const { cpu } = createTestBlua32PairCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('value')), 2);
	cpu.beginCompletionCallInExecutionDomain(0, image.cartVectors.initFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('value')), 4);
});

test('init function placement and signature are compile-time contracts', () => {
	for (const source of [
		'if true then local function refresh<init>() end end',
		'while false do local function refresh<init>() end end',
		'local function outer() local function refresh<init>() end end',
	]) {
		assert.throws(
			() => compileSystem(source),
			/Function attribute <init> is only valid on module\/chunk top-level local functions\./,
		);
	}
	for (const source of [
		'local function refresh<init>(state) end',
		'local function refresh<init>(...) end',
	]) {
		assert.throws(
			() => compileSystem(source),
			/Function attribute <init> requires a zero-parameter, non-vararg function\./,
		);
	}
});

test('compile-time modules cannot declare init functions', () => {
	const entrySource = 'return 0';
	assert.throws(
		() => compileSystem(entrySource, [{
			path: 'constants',
			source: 'module<const>\nlocal function refresh<init>() end\nreturn {}',
		}]),
		/Compile-time module 'constants\.lua' cannot declare an <init> function\./,
	);
	assert.throws(
		() => compileSystem('local run<const> = require("worker")\nreturn run()', [{
			path: 'worker',
			source: 'module<const>\nlocal function refresh<init>() end\nreturn function() return 1 end',
		}]),
		/Compile-time module 'worker\.lua' cannot declare an <init> function\./,
	);
});

test('cart modules with init functions must be statically required', () => {
	const entrySource = 'return 0';
	const moduleSource = 'local function orphan<init>() marker = 1 end\nreturn {}';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseLuaChunk(entrySource, 'entry.lua'),
			[{
				path: 'orphan',
				source: moduleSource,
				chunk: parseLuaChunk(moduleSource, 'orphan.lua'),
			}],
			{ entrySource, programDomain: 'cart' },
		),
		/Module 'orphan' declares <init> but is not statically required by the program\./,
	);
});

test('programs without module initialization or participants publish no preparation sequence', () => {
	const compiled = compileSystem('return 7');
	assert.equal(compiled.initProtoIndex, null);
	assert.deepEqual(compiled.metadata.initParticipants, []);
	const image = linkTestSystemBlua32(compiled);
	assert.equal(image.vectors.initFunctionAddress, 0);
	assert.equal(image.image.header.initFunctionAddress, 0);
	assert.deepEqual(image.symbols.initParticipants, []);
});
