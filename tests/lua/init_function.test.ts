import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
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

test('init functions run once at cold lexical points and retained vector reruns in dependency order', () => {
	const entrySource = [
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
	assert.equal(image.symbols.initFunctionAddress, image.vectors.initFunctionAddress);
	assert.deepEqual(image.symbols.initParticipants, compiled.metadata.initParticipants);
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1234]);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('trace')), 1234);

	cpu.beginCompletionCallInExecutionDomain(
		SYSTEM_EXECUTION_DOMAIN_ID,
		image.vectors.initFunctionAddress,
	);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('trace')), 12341234);
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

test('cold init invocation preserves the annotated local function binding', () => {
	const source = [
		'local calls = 0',
		'local function refresh<init>() calls = calls + 1 return 99 end',
		'local value = refresh()',
		'return calls, value',
	].join('\n');
	const compiled = compileSystem(source);
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [2, 99]);
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
			source: 'local function refresh<init>() end\nreturn function() return 1 end',
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

test('programs without init participants publish no init vector', () => {
	const compiled = compileSystem('return 7');
	assert.equal(compiled.initProtoIndex, null);
	assert.deepEqual(compiled.metadata.initParticipants, []);
	const image = linkTestSystemBlua32(compiled);
	assert.equal(image.vectors.initFunctionAddress, 0);
	assert.equal(image.symbols.initFunctionAddress, 0);
	assert.deepEqual(image.symbols.initParticipants, []);
});
