import { readFileSync } from 'node:fs';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { TraceStatementMode } from '../../toolchain/ts/lua/compiler/trace_statement';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { createTestBlua32PairCpu, linkTestBlua32Pair } from './blua32';
import { parseLuaChunk } from '../lua/cpu_test_harness';

/** Real cartlib/compiler/CPU; no host, ICU, world scheduler or trigonometry proof. */
type CartlibProgramOptions = {
	traceStatements?: TraceStatementMode;
	optLevel?: 0 | 3;
	/** Additional or replacement cart modules, compiled normally by path. */
	modules?: readonly { path: string; source: string }[];
};

const SYSTEM_MODULE_FILES = [
	['base', 'machine/bios/base.lua'],
	['table', 'machine/bios/table.lua'],
	['string/base', 'machine/bios/string/base.lua'],
	['string/utf8', 'machine/bios/string/utf8.lua'],
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
	['cartlib/fsm/frame_evaluator_syntax', 'cartlib/fsm/frame_evaluator_syntax.lua'],
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

const SYSTEM_ENTRY_SOURCE = `
require('base')
table = require('table')
string = require('string/base')
string.find = require('string/pattern').find
lua_compiler = require('compiler/api')
load = lua_compiler.load
math = { sin = function(value) return value end, pi = 3.141592653589793 }
assert(setmetatable ~= nil)
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;

export function createCartlibProgramHarness(
	cartEntrySource: string,
	{ traceStatements = 'erase', optLevel = 3, modules = [] }: CartlibProgramOptions = {},
) {
	const systemSources = new Map<string, string>(SYSTEM_MODULE_FILES.map(([path, file]) => [path, readFileSync(file, 'utf8')]));
	for (const module of SYSTEM_STUB_MODULES) systemSources.set(module.path, module.source);
	const systemModules = Array.from(systemSources, ([path, source]) => ({
		path, source, chunk: parseLuaChunk(source, `${path}.lua`),
	}));
	const cartSources = new Map<string, string>(CART_MODULE_FILES.map(([path, file]) => [path, readFileSync(file, 'utf8')]));
	for (const module of CART_STUB_MODULES) cartSources.set(module.path, module.source);
	for (const module of modules) cartSources.set(module.path, module.source);
	const cartModules = Array.from(cartSources, ([path, source]) => ({
		path, source, chunk: parseLuaChunk(source, `${path}.lua`),
	}));
	const systemCompiled = compileLuaChunkToProgram(parseLuaChunk(SYSTEM_ENTRY_SOURCE, 'boot.lua'), systemModules, {
		entrySource: SYSTEM_ENTRY_SOURCE,
		optLevel,
		programDomain: 'system',
	});
	const cartCompiled = compileLuaChunkToProgram(parseLuaChunk(cartEntrySource, 'entry.lua'), cartModules, {
		entrySource: cartEntrySource,
		optLevel,
		programDomain: 'cart',
		traceStatements,
	});
	const images = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const { cpu } = createTestBlua32PairCpu(images);
	cpu.installBootPrimitives();
	return { cpu, images, cart: cartCompiled };
}
