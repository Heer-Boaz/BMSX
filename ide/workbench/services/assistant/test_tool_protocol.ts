import { decodeTestInspectionRequest, STUDIO_TEST_INSPECTION_TOOLS, type TestInspectionRequest } from './test_inspection_protocol';
import { StudioToolInputError, toolArguments } from './tool_input';

export type TestToolRequest =
	| TestInspectionRequest
	| { name: 'studio_list_tests' }
	| { name: 'studio_start_test_run'; scope: string }
	| { name: 'studio_wait_test_run' | 'studio_cancel_test_run'; run: string }
	| { name: 'studio_list_test_runs' }
	| { name: 'studio_read_test_run'; run: string }
	| { name: 'studio_read_test_result'; result: string };

const NO_FIELDS: string[] = [];
const SCOPE_FIELDS = ['scope'];
const RUN_FIELDS = ['run'];
const RESULT_FIELDS = ['result'];

export const STUDIO_TEST_TOOLS = [
	...STUDIO_TEST_INSPECTION_TOOLS,
	{ name: 'studio_list_tests', description: 'Discover current Scenario Lab project/module/named-case selections, including unsaved Lua declarations and declaration diagnostics, without executing guest code. Scope handles belong to this prompt and source owner. Source coordinates are one-based. Starting a scope resolves its current declarations and sources, not a cached discovery snapshot.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_start_test_run', description: 'Start a discovered scope through the ordinary Scenario Lab runner. Captures current workspace sources before asynchronous preparation; every case gets a separate physical test machine. Does not save, install or run the authoring game. Returns an admission receipt, NOT completion or a pass. Use studio_wait_test_run once, not read polling. One workspace run at a time; no hidden queue or retry. This prompt owns cancellation of runs it starts; prompt completion, Stop or disconnect cancels unfinished owned runs.',
		inputSchema: { type: 'object', properties: { scope: { type: 'string' } }, required: SCOPE_FIELDS, additionalProperties: false } },
	{ name: 'studio_wait_test_run', description: 'Wait for a listed or started run to really finish preparation, cases and bounded cancellation cleanup; return the terminal run/case summaries. Event-driven, no polling or additional model turns. Can observe a manually started run without owning it. Cancelling this wait only detaches the observer; it does not cancel the run.',
		inputSchema: { type: 'object', properties: { run: { type: 'string' } }, required: RUN_FIELDS, additionalProperties: false } },
	{ name: 'studio_cancel_test_run', description: 'Cancel only a run started by this prompt, then wait for its terminal result including bounded cleanup. Never cancels a manual or other-prompt run. Already completed owned runs return their recorded outcome; cancellation does not rewrite it.',
		inputSchema: { type: 'object', properties: { run: { type: 'string' } }, required: RUN_FIELDS, additionalProperties: false } },
	{ name: 'studio_list_test_runs', description: 'List currently retained Studio test runs, newest first. This explicit read admits prompt-local observation handles, NOT cancellation authority over manual or other-prompt runs. Empty history is not a passing workspace. Outcomes are historical; no current-source or dependency correspondence is asserted. Never starts, waits for or cancels a test.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_test_run', description: 'Read a listed test run and its case summaries. Running includes pending preparation and is not completion. Case handles allow targeted evidence reads without sending every suite source or log. Reading does not execute or wait for tests; do not poll.',
		inputSchema: { type: 'object', properties: { run: { type: 'string' } }, required: RUN_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_test_result', description: 'Read one listed case result: recorded outcome, exact accepted suite text, phase failures, stacks, retained logs/captures and trace facts. Source coverage is the suite only, not current workspace/dependency certification. Preparation failure may not have executed it. Omitted counts describe Studio result-ring eviction, not undetected guest producer-ring loss; capture metadata is not image pixels. Source ranges and locations are one-based Lua coordinates. Raw producer time words remain register words. This is not a source edit receipt, debugger attachment or execution tool.',
		inputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: RESULT_FIELDS, additionalProperties: false } },
];

export function decodeTestToolRequest(name: string, input: unknown): TestToolRequest {
	switch (name) {
		case 'studio_list_tests':
		case 'studio_list_test_runs': toolArguments(input, NO_FIELDS); return { name };
		case 'studio_start_test_run': {
			const value = toolArguments(input, SCOPE_FIELDS);
			if (typeof value.scope !== 'string') throw new StudioToolInputError('scope must be a discovered Studio test scope handle');
			return { name, scope: value.scope };
		}
		case 'studio_wait_test_run':
		case 'studio_cancel_test_run':
		case 'studio_read_test_run': {
			const value = toolArguments(input, RUN_FIELDS);
			if (typeof value.run !== 'string') throw new StudioToolInputError('run must be a listed Studio run handle');
			return { name, run: value.run };
		}
		case 'studio_read_test_result': {
			const value = toolArguments(input, RESULT_FIELDS);
			if (typeof value.result !== 'string') throw new StudioToolInputError('result must be a listed Studio case handle');
			return { name, result: value.result };
		}
		default: return decodeTestInspectionRequest(name, input);
	}
}
