import { loadHeapServiceTestModules, loadTestBiosUtilityModules } from './heap_service_system';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, type CompiledSystemProgram } from '../../toolchain/ts/lua/compiler';
import { collectLuaModuleDependencyClosure } from '../../toolchain/ts/lua/compiler/module_graph';
import type { TraceStatementSelection } from '../../toolchain/ts/lua/compiler/trace_statement';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { createTestBlua32PairCpu, linkTestBlua32Pair } from './blua32';
import { BASE_FIRMWARE_MODULES, COROUTINE_FIRMWARE_MODULES } from './firmware_modules';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from './cpu_test_harness';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from './cpu_execution';
import { WORLD_CPU_MODULES } from './world_cpu';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, valueInteger } from '../../machine/ts/machine/cpu/value';

/** Real cartlib/compiler/CPU and BIOS math; no host, ICU or world scheduler. */
type CartlibProgramOptions = {
	traceStatements?: TraceStatementSelection;
	preloadModules?: readonly string[];
	optLevel?: 0 | 3;
	/** Additional or replacement cart modules, compiled normally by path. */
	modules?: readonly { path: string; source: string }[];
};

const SYSTEM_MODULE_FILES = [
	['table', 'machine/bios/table.lua'],
	['string/base', 'machine/bios/string/base.lua'],
	['utf8', 'machine/bios/utf8.lua'],
	['string/pattern', 'machine/bios/string/pattern.lua'],
	['compiler/api', 'machine/bios/compiler/api.lua'],
	['compiler/arena', 'machine/bios/compiler/arena.lua'],
	['compiler/bytecode', 'machine/bios/compiler/bytecode.lua'],
	['compiler/compiler', 'machine/bios/compiler/compiler.lua'],
	['compiler/lexer', 'machine/bios/compiler/lexer.lua'],
	['compiler/linker', 'machine/bios/compiler/linker.lua'],
	['compiler/load', 'machine/bios/compiler/load.lua'],
	['compiler/parser', 'machine/bios/compiler/parser.lua'],
	['compiler/semantic', 'machine/bios/compiler/semantic.lua'],
	['compiler/syntax', 'machine/bios/compiler/syntax.lua'],
	['compiler/syntax_factory', 'machine/bios/compiler/syntax_factory.lua'],
	['compiler/token', 'machine/bios/compiler/token.lua'],
] as const;

const CART_MODULE_FILES = [
	['cartlib/world/tick_group', 'cartlib/world/tick_group.lua'],
	['cartlib/timeline/channel_binding', 'cartlib/timeline/channel_binding.lua'],
	['cartlib/world/world_object', 'cartlib/world/world_object.lua'],
	['cartlib/world/object_2d', 'cartlib/world/object_2d.lua'],
	['cartlib/world/object_3d', 'cartlib/world/object_3d.lua'],
	['cartlib/component/visual_component', 'cartlib/component/visual_component.lua'],
	['cartlib/component/visual_2d_component', 'cartlib/component/visual_2d_component.lua'],
	['cartlib/world/spatial_hierarchy', 'cartlib/world/spatial_hierarchy.lua'],
	['cartlib/math/affine2', 'cartlib/math/affine2.lua'],
	['cartlib/math/affine3', 'cartlib/math/affine3.lua'],
	['cartlib/util/dense_set', 'cartlib/util/dense_set.lua'],
	['cartlib/component/component_class', 'cartlib/component/component_class.lua'],
	['cartlib/registry', 'cartlib/registry.lua'],
	['cartlib/event_emitter', 'cartlib/event_emitter.lua'],
	['cartlib/component/base_component', 'cartlib/component/base_component.lua'],
	['cartlib/clock', 'cartlib/clock.lua'],
	['cartlib/timeline/clock_source', 'cartlib/timeline/clock_source.lua'],
	['cartlib/easing', 'cartlib/easing.lua'],
	['cartlib/timeline/playback', 'cartlib/timeline/playback.lua'],
	['cartlib/timeline/apply_syntax', 'cartlib/timeline/apply_syntax.lua'],
	['cartlib/timeline/apply', 'cartlib/timeline/apply.lua'],
	['cartlib/timeline/scalar_channel_syntax', 'cartlib/timeline/scalar_channel_syntax.lua'],
	['cartlib/timeline/scalar_channel', 'cartlib/timeline/scalar_channel.lua'],
	['cartlib/timeline/event_lane_shape', 'cartlib/timeline/event_lane_shape.lua'],
	['cartlib/timeline/packed_steps', 'cartlib/timeline/packed_steps.lua'],
	['cartlib/timeline/track_program', 'cartlib/timeline/track_program.lua'],
	['cartlib/timeline/sequence_program', 'cartlib/timeline/sequence_program.lua'],
	['cartlib/timeline/step_track_syntax', 'cartlib/timeline/step_track_syntax.lua'],
	['cartlib/timeline/value_runner_signature', 'cartlib/timeline/value_runner_signature.lua'],
	['cartlib/timeline/track_evaluator_syntax', 'cartlib/timeline/track_evaluator_syntax.lua'],
	['cartlib/timeline/track_evaluator', 'cartlib/timeline/track_evaluator.lua'],
	['cartlib/timeline/evaluation_context', 'cartlib/timeline/evaluation_context.lua'],
	['cartlib/timeline/event_evaluator_syntax', 'cartlib/timeline/event_evaluator_syntax.lua'],
	['cartlib/timeline/evaluation_program_syntax', 'cartlib/timeline/evaluation_program_syntax.lua'],
	['cartlib/timeline/evaluation_program', 'cartlib/timeline/evaluation_program.lua'],
	['cartlib/timeline/frame_program', 'cartlib/timeline/frame_program.lua'],
	['cartlib/timeline/program', 'cartlib/timeline/program.lua'],
	['cartlib/timeline/child_transport_syntax', 'cartlib/timeline/child_transport_syntax.lua'],
	['cartlib/timeline/sequence_evaluator_syntax', 'cartlib/timeline/sequence_evaluator_syntax.lua'],
	['cartlib/timeline/time_transform_syntax', 'cartlib/timeline/time_transform_syntax.lua'],
	['cartlib/timeline/time_transform', 'cartlib/timeline/time_transform.lua'],
	['cartlib/timeline/timeline', 'cartlib/timeline/timeline.lua'],
	['cartlib/timeline/sequence_evaluator', 'cartlib/timeline/sequence_evaluator.lua'],
	['cartlib/timeline/timeline_component', 'cartlib/timeline/timeline_component.lua'],
	['cartlib/util/clamp', 'cartlib/util/clamp.lua'],
	['cartlib/util/clear_map', 'cartlib/util/clear_map.lua'],
	['cartlib/fsm/frame_program', 'cartlib/fsm/frame_program.lua'],
	['cartlib/fsm/fsm', 'cartlib/fsm/fsm.lua'],
	['testlib/fsm/transition_recorder', 'testlib/fsm/transition_recorder.lua'],
	['cartlib/fsm/library', 'cartlib/fsm/library.lua'],
	['cartlib/fsm/fsm_component', 'cartlib/fsm/fsm_component.lua'],
	['cartlib/behaviour_tree/result', 'cartlib/behaviour_tree/result.lua'],
	['cartlib/behaviour_tree/blackboard', 'cartlib/behaviour_tree/blackboard.lua'],
	['cartlib/behaviour_tree/execution_layout', 'cartlib/behaviour_tree/execution_layout.lua'],
	['cartlib/behaviour_tree/timeline_task', 'cartlib/behaviour_tree/timeline_task.lua'],
	['cartlib/behaviour_tree/task_program', 'cartlib/behaviour_tree/task_program.lua'],
	['cartlib/behaviour_tree/blackboard_program', 'cartlib/behaviour_tree/blackboard_program.lua'],
	['cartlib/behaviour_tree/observer_program', 'cartlib/behaviour_tree/observer_program.lua'],
	['cartlib/behaviour_tree/decorator_program', 'cartlib/behaviour_tree/decorator_program.lua'],
	['cartlib/behaviour_tree/service_program', 'cartlib/behaviour_tree/service_program.lua'],
	['cartlib/behaviour_tree/wait_task', 'cartlib/behaviour_tree/wait_task.lua'],
	['cartlib/behaviour_tree/node_program', 'cartlib/behaviour_tree/node_program.lua'],
	['cartlib/behaviour_tree/program', 'cartlib/behaviour_tree/program.lua'],
	['cartlib/behaviour_tree/bt_component', 'cartlib/behaviour_tree/bt_component.lua'],
	['cartlib/behaviour_tree/library', 'cartlib/behaviour_tree/library.lua'],
] as const;

const SYSTEM_STUB_MODULES = [
	{
		path: 'bmsx/blua32',
		source: BLUA32_FIRMWARE_MODULE_SOURCE,
	},
	{
		path: 'tty/console',
		source: 'return { write = function() end, end_line = function() end }',
	},
] as const;

const CART_STUB_MODULES = [
	{
		path: 'cartlib/input/input',
		source: `return {
			bind = function(_, pattern) return pattern end,
			is_active = function() return false end,
		}`,
	},
] as const;

let defaultCartSources: ReadonlyMap<string, string> | undefined;

// The firmware half depends only on fixed sources and the optimization level,
// so one test process compiles it once per level and links that program into
// every cart image.
const systemPrograms = new Map<0 | 3, CompiledSystemProgram>();
function compileCartlibSystem(optLevel: 0 | 3) {
	let compiled = systemPrograms.get(optLevel);
	if (compiled !== undefined) return compiled;
	const systemSources = new Map<string, string>(SYSTEM_MODULE_FILES.map(([path, file]) => [path, readFileSync(file, 'utf8')]));
	for (const module of BASE_FIRMWARE_MODULES) systemSources.set(module.path, module.source);
	for (const module of SYSTEM_STUB_MODULES) systemSources.set(module.path, module.source);
	for (const module of COROUTINE_FIRMWARE_MODULES) systemSources.set(module.path, module.source);
	for (const path of ['math', 'math/trig', 'math/trig/reduce']) systemSources.set(path, readFileSync(`machine/bios/${path}.lua`, 'utf8'));
	const systemModules = Array.from(systemSources, ([path, source]) => ({
		path, source, chunk: parseLuaChunk(source, `${path}.lua`),
	}));
	const systemEntry = `
require('base')
coroutine = require('coroutine')
table = require('table')
string = require('string/base')
utf8 = require('utf8')
string.find = require('string/pattern').find
lua_compiler = require('compiler/api')
load = lua_compiler.load
math = require('math')
assert(setmetatable ~= nil)
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	compiled = compileLuaChunkToProgram(parseLuaChunk(systemEntry, 'boot.lua'), [
		...loadHeapServiceTestModules(),
		...loadTestBiosUtilityModules().filter(module => !systemModules.some(input => input.path === module.path)),
		...systemModules,
	], {
		entrySource: systemEntry,
		optLevel,
		preloadModules: HEAP_SERVICE_MODULES,
		programDomain: 'system',
	});
	systemPrograms.set(optLevel, compiled);
	return compiled;
}

export function compileCartlibProgram(
	cartEntrySource: string,
	{ traceStatements = 'erase', preloadModules = [], optLevel = 3, modules = [] }: CartlibProgramOptions = {},
) {
	const cartSources = new Map(defaultCartSources ??= new Map<string, string>(
		CART_MODULE_FILES.map(([path, file]) => [path, readFileSync(file, 'utf8')]),
	));
	for (const module of WORLD_CPU_MODULES) cartSources.set(module.path, module.source);
	for (const module of CART_STUB_MODULES) cartSources.set(module.path, module.source);
	for (const module of modules) cartSources.set(module.path, module.source);

	const entry = parseLuaChunk(cartEntrySource, 'entry.lua');
	const parsed = new Map<string, ReturnType<typeof parseLuaChunk>>();
	const parseModule = (path: string) => {
		let chunk = parsed.get(path);
		if (chunk === undefined) {
			chunk = parseLuaChunk(cartSources.get(path)!, `${path}.lua`);
			parsed.set(path, chunk);
		}
		return chunk;
	};
	const preload = preloadModules.filter(path => cartSources.has(path));
	collectLuaModuleDependencyClosure([entry, ...preload.map(parseModule)], new Set(cartSources.keys()), parseModule);
	// Keep the regular ROM layout order. Only parsed, reachable sources are linked.
	const cartModules = [];
	for (const [path, source] of cartSources) {
		const chunk = parsed.get(path);
		if (chunk !== undefined) cartModules.push({ path, source, chunk });
	}
	const systemCompiled = compileCartlibSystem(optLevel);
	const cartCompiled = compileLuaChunkToProgram(entry, cartModules, {
		entrySource: cartEntrySource,
		optLevel,
		programDomain: 'cart',
		traceStatements,
		preloadModules,
	});
	const images = linkTestBlua32Pair(systemCompiled, cartCompiled);
	return { images, cart: cartCompiled, cartSources };
}

export function createCartlibProgramHarness(cartEntrySource: string, options: CartlibProgramOptions = {}) {
	const { images, cart } = compileCartlibProgram(cartEntrySource, options);
	const { cpu } = createTestBlua32PairCpu(images);
	return { cpu, images, cart };
}

/**
 * A test ROM, as emulator test suites use: the cases of a test file are guest
 * functions in one cart, compiled and booted once. Every case starts from the
 * same post-boot checkpoint, so cases stay as isolated as separate carts.
 * Cases are added before the first one runs.
 */
export function createCartlibCaseRom(prelude: string, options: CartlibProgramOptions = {}) {
	const bodies: string[] = [];
	let booted: { cpu: CPU; runner: number; checkpoint: ReturnType<typeof captureCpuCheckpoint> } | undefined;
	const rom = {
		add(body: string): number {
			assert.equal(booted, undefined, 'cases are added before the first case runs');
			return bodies.push(body);
		},
		/** Register a guest case that must return to the runner within the budget. */
		test(name: string, body: string, budget = 20_000_000): void {
			const index = rom.add(body);
			test(name, () => { rom.run(index, budget); });
		},
		run(index: number, budget = 20_000_000): CPU {
			if (booted === undefined) {
				const cases = bodies.map(body => `function()\n${body}\nend,`).join('\n');
				const { cpu } = createCartlibProgramHarness(`${prelude}
local test_cases<const> = {
${cases}
}
return function(index) return test_cases[index]() end
`, options);
				runGuestToHalt(cpu, budget);
				booted = { cpu, runner: asClosure(materializeCpuCompletionValues(cpu)[0], cpu.gc), checkpoint: captureCpuCheckpoint(cpu) };
			} else restoreCpuCheckpoint(booted.cpu, booted.checkpoint);
			runCompletionClosure(booted.cpu, booted.runner, [valueInteger(index)], budget);
			assert.equal(booted.cpu.completionCallPending(), false, 'the guest case returned to its runner');
			return booted.cpu;
		},
	};
	return rom;
}
