import type { SourceExecutionMode } from '../../../runtime/source_debugger';
import { StudioToolInputError, toolArguments } from './tool_input';

export type TestDebuggerRequest =
	| { name: 'studio_debug_test'; scope: string }
	| { name: 'studio_wait_test_debugger' | 'studio_list_test_debug_sources' | 'studio_pause_test_debugger'; run: string }
	| { name: 'studio_read_test_debug_source'; run: string; source: string }
	| { name: 'studio_set_test_breakpoints'; run: string; source: string; lines: number[] }
	| { name: 'studio_inspect_test_stop'; run: string; revision: number }
	| { name: 'studio_resume_test_debugger'; run: string; revision: number; mode: SourceExecutionMode };
const SCOPE = ['scope'], RUN = ['run'], SOURCE = ['run', 'source'], POINTS = ['run', 'source', 'lines'];
const STOP = ['run', 'revision'], RESUME = ['run', 'revision', 'mode'];
const RUN_PROPERTY = { run: { type: 'string' } }, STOP_PROPERTIES = { ...RUN_PROPERTY, revision: { type: 'integer', minimum: 0 } };
export const STUDIO_TEST_DEBUGGER_TOOLS = [
	{ name: 'studio_debug_test', description: 'Start exactly one discovered named case in Scenario Lab debug mode. Captures accepted sources into a separate physical test machine, stopping after module initialization and before test bind/setup/body. Does not retarget or run the authoring game. Returns admission, not a stop or pass; call studio_wait_test_debugger once. Ordinary run budgets and cleanup still apply. This prompt owns the run: unfinished tests are cancelled on prompt completion, Stop or disconnect. No module/project debug or hidden queue.',
		inputSchema: { type: 'object', properties: { scope: { type: 'string' } }, required: SCOPE, additionalProperties: false } },
	{ name: 'studio_wait_test_debugger', description: 'Wait event-driven for a debug run to prepare and actually stop, or terminate. Returns exact target/stop revision and stepping capabilities, or the terminal run if preparation/execution finished. May observe a manual debug run, without gaining control. Never polls. Cancelling this wait detaches only the observer.',
		inputSchema: { type: 'object', properties: RUN_PROPERTY, required: RUN, additionalProperties: false } },
	{ name: 'studio_pause_test_debugger', description: 'Pause this prompt\'s currently running debug test between bounded CPU grants. Returns the actual current debugger state; no polling or authoring pause. An already stopped test keeps its stop, and initializing still requires studio_wait_test_debugger for admission. Does not cancel the case or run teardown. Cannot pause a manual or other-prompt run.',
		inputSchema: { type: 'object', properties: RUN_PROPERTY, required: RUN, additionalProperties: false } },
	{ name: 'studio_list_test_debug_sources', description: 'List this active test debugger\'s immutable compiled sources. Physical socket and original authored socket are distinct. Source handles belong to this test, not the authoring gutter or editor models. Read source text before choosing breakpoint lines.',
		inputSchema: { type: 'object', properties: RUN_PROPERTY, required: RUN, additionalProperties: false } },
	{ name: 'studio_read_test_debug_source', description: 'Read exact compiled test/BIOS/companion source and requested breakpoint bindings. One-based lines. Dirty editor changes after admission do not change these images. No source edit or save authority.',
		inputSchema: { type: 'object', properties: { ...RUN_PROPERTY, source: { type: 'string' } }, required: SOURCE, additionalProperties: false } },
	{ name: 'studio_set_test_breakpoints', description: 'For a debug run started by this prompt, replace one compiled source\'s exact breakpoint list; [] clears that source. Returns bound physical PCs or explicit no-statement/symbols-unavailable. No nearest-line guessing, working-copy coordinates or changes to authoring breakpoints. Read existing breakpoints before preserving/changing manual settings.',
		inputSchema: { type: 'object', properties: { ...RUN_PROPERTY, source: { type: 'string' }, lines: { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true } }, required: POINTS, additionalProperties: false } },
	{ name: 'studio_inspect_test_stop', description: 'Borrow a currently stopped live test at the observed debugger revision. Returns globals and the actual stopped thread\'s stack handle. Replaces this prompt\'s test inspection. Frames/locals/upvalues/stored tables use the shared test inspection tools, without executing Lua. All handles expire BEFORE resume, cleanup, target replacement or prompt retirement. Thread completion is explicit: failed-thread frames may be inspected but not resumed; dead threads have no stack. This is not retained post-mortem inspection or Terminal evaluation.',
		inputSchema: { type: 'object', properties: STOP_PROPERTIES, required: STOP, additionalProperties: false } },
	{ name: 'studio_resume_test_debugger', description: 'Continue or step into/over/out in an owned live test, only at the exact observed stop revision. Awaits a real breakpoint, step, thread completion, runner operation boundary or termination. Entry/manual/boundary stops allow Continue only; respect returned capabilities. The runner alone executes and accounts CPU grants; stepping cannot bypass its publication fences or budgets. No polling. All prior value/frame handles expire. Request cancellation pauses only this command\'s execution; prompt Stop additionally cancels its owned run with bounded cleanup.',
		inputSchema: { type: 'object', properties: { ...STOP_PROPERTIES, mode: { type: 'string', enum: ['continue', 'into', 'over', 'out'] } }, required: RESUME, additionalProperties: false } },
];

export function decodeTestDebuggerRequest(name: string, input: unknown): TestDebuggerRequest {
	switch (name) {
		case 'studio_debug_test': {
			const value = toolArguments(input, SCOPE);
			if (typeof value.scope !== 'string') throw new StudioToolInputError('scope must identify a discovered named case');
			return { name, scope: value.scope };
		}
		case 'studio_wait_test_debugger': case 'studio_list_test_debug_sources': case 'studio_pause_test_debugger': {
			const value = toolArguments(input, RUN);
			if (typeof value.run !== 'string') throw new StudioToolInputError('run must identify a debug run');
			return { name, run: value.run };
		}
		case 'studio_read_test_debug_source': case 'studio_set_test_breakpoints': {
			const value = toolArguments(input, name === 'studio_read_test_debug_source' ? SOURCE : POINTS);
			if (typeof value.run !== 'string' || typeof value.source !== 'string') throw new StudioToolInputError('run and source must identify this test debugger');
			if (name === 'studio_read_test_debug_source') return { name, run: value.run, source: value.source };
			if (!Array.isArray(value.lines) || value.lines.some(line => !Number.isSafeInteger(line) || line < 1) || new Set(value.lines).size !== value.lines.length) {
				throw new StudioToolInputError('lines must be distinct positive integers');
			}
			return { name, run: value.run, source: value.source, lines: value.lines };
		}
		case 'studio_inspect_test_stop': case 'studio_resume_test_debugger': {
			const value = toolArguments(input, name === 'studio_inspect_test_stop' ? STOP : RESUME);
			if (typeof value.run !== 'string' || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new StudioToolInputError('A debug run and observed non-negative integer revision are required');
			if (name === 'studio_inspect_test_stop') return { name, run: value.run, revision: value.revision as number };
			if (!['continue', 'into', 'over', 'out'].includes(value.mode as string)) throw new StudioToolInputError('mode must be continue, into, over or out');
			return { name, run: value.run, revision: value.revision as number, mode: value.mode as SourceExecutionMode };
		}
		default: throw new StudioToolInputError(`Unknown Studio test tool: ${name}`);
	}
}
