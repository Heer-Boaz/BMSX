import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { Table } from '../../machine/ts/machine/cpu/table';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const sources = [
	{ path: 'common', source: 'return { order = 0, calls = 0 }' },
	{ path: 'first', source: `local common<const> = require('common')
common.order = common.order * 10 + 1
local function refresh<init>() common.calls = common.calls * 10 + 1 end
return common` },
	{ path: 'second', source: `local common<const> = require('common')
common.order = common.order * 10 + 2
local function refresh<init>() common.calls = common.calls * 10 + 2 end
return common` },
	{ path: 'game', source: `local common<const> = require('common')
common.order = common.order * 10 + 3
local function refresh<init>() common.calls = common.calls * 10 + 3 end
return common` },
	{ path: 'constants', source: 'module<const>\nreturn { value = 7 }' },
];
const modules = sources.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const entrySource = `local game<const> = require('game')
local first<const> = require('first')
local function refresh<init>() game.calls = game.calls * 10 + 4 end
return game.order, game.calls, first == game`;

for (const optLevel of [0, 3] as const) test(`preloads use the existing dependency/startup/init owners (O${optLevel})`, () => {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry'), modules, {
		entrySource, programDomain: 'system', optLevel,
		preloadModules: ['second', 'constants', 'first', 'second'],
	});
	assert.deepEqual(compiled.staticModulePaths, ['common', 'second', 'first', 'game']);
	assert.deepEqual(compiled.metadata.initParticipants.map(item => item.functionId), [
		'module:second/module/local:refresh', 'module:first/module/local:refresh',
		'module:game/module/local:refresh', 'module:entry/entry/local:refresh',
	]);
	const image = linkTestSystemBlua32(compiled);
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [213, 0, true]);
	const common = cpu.getSystemGlobalByKey(cpu.stringPool.find(buildModuleExportSlotName('common', []))!) as Table;
	// Read the retained exported object through the compiler-owned module slot.
	assert.ok(common instanceof Table);
	cpu.beginCompletionCallInExecutionDomain(-1, image.vectors.initFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.equal(common.getStringKey(cpu.stringPool.find('calls')!), 2134);
	assert.equal(common.getStringKey(cpu.stringPool.find('order')!), 213, 'init does not repeat module constructors');
});

test('default and explicit empty preloads preserve executable bytes; cycles use require diagnostics', () => {
	const source = 'local game<const> = require("game") return game';
	const withoutInits = modules.map(module => {
		const source = module.source.replace(/^local function refresh<init>.*$/m, '');
		return { ...module, source, chunk: parseLuaChunk(source, module.path) };
	});
	const options = { entrySource: source, programDomain: 'system' as const, optLevel: 3 as const };
	const baseline = compileLuaChunkToProgram(parseLuaChunk(source, 'entry'), withoutInits, options);
	const explicit = compileLuaChunkToProgram(parseLuaChunk(source, 'entry'), withoutInits, { ...options, preloadModules: [], traceStatements: [] });
	assert.deepEqual(explicit.program, baseline.program);
	const cycle = [
		{ path: 'a', source: 'require("b") return {}' },
		{ path: 'b', source: 'require("a") return {}' },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
	assert.throws(() => compileLuaChunkToProgram(parseLuaChunk('return 0', 'entry'), cycle,
		{ entrySource: 'return 0', preloadModules: ['a'] }), /require cycle/);
});

for (const optLevel of [0, 3] as const) test(`preload observes the first real module-scope BT compilation (O${optLevel})`, () => {
	const { cpu, cart } = createCartlibProgramHarness(`local actor<const> = require('fixture/game')
local observation<const> = require('fixture/observation')
local compiled<const> = observation.completed_bindings[actor]
local capture<const> = observation.programs[compiled]
return #capture.nodes, capture.nodes[1].type == 'sequence', capture.nodes[2].type == 'task'
`, {
		optLevel,
		preloadModules: ['fixture/observation'],
		traceStatements: ['bt.compile.begin', 'bt.compile.node', 'bt.compile.end', 'bt.bind.complete'],
		modules: [
			{ path: 'testlib/behaviour_tree/compile_recorder', source: readFileSync('testlib/behaviour_tree/compile_recorder.lua', 'utf8') },
			{ path: 'fixture/observation', source: `local recorder<const> = require('testlib/behaviour_tree/compile_recorder')
return recorder.new()` },
			{ path: 'fixture/game', source: `local library<const> = require('cartlib/behaviour_tree/library')
local component<const> = require('cartlib/behaviour_tree/bt_component')
library.register('early', { root = { type = 'sequence', children = {
	{ type = 'task', task = { execute = function() return 1 end } },
} } })
return component.new({ parent = {} }, 'early')` },
		],
	});
	assert.ok(cart.staticModulePaths.indexOf('fixture/observation') < cart.staticModulePaths.indexOf('fixture/game'));
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [2, true, true]);
});
