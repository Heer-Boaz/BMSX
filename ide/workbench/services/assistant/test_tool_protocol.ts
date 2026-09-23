import { StudioToolInputError, toolArguments } from './tool_input';

export type TestToolRequest =
	| { name: 'studio_list_test_runs' }
	| { name: 'studio_read_test_run'; run: string }
	| { name: 'studio_read_test_result'; result: string };

const NO_FIELDS: string[] = [];
const RUN_FIELDS = ['run'];
const RESULT_FIELDS = ['result'];

export const STUDIO_TEST_TOOLS = [
	{ name: 'studio_list_test_runs', description: 'List retained Studio test runs known at this prompt start, newest first. Empty history is not a passing workspace. Outcomes are historical; no current-source or dependency correspondence is asserted. Never starts, reruns, waits for or cancels a test. Handles belong only to this prompt.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_test_run', description: 'Read a listed test run and its case summaries. Running includes pending preparation and is not completion. Case handles allow targeted evidence reads without sending every suite source or log. Reading does not execute or wait for tests; do not poll.',
		inputSchema: { type: 'object', properties: { run: { type: 'string' } }, required: RUN_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_test_result', description: 'Read one listed case result: recorded outcome, exact accepted suite text, phase failures, stacks, retained logs/captures and trace facts. Source coverage is the suite only, not current workspace/dependency certification. Preparation failure may not have executed it. Omitted counts describe Studio result-ring eviction, not undetected guest producer-ring loss; capture metadata is not image pixels. Source ranges and locations are one-based Lua coordinates. Raw producer time words remain register words. This is not a source edit receipt, debugger attachment or execution tool.',
		inputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: RESULT_FIELDS, additionalProperties: false } },
];

export function decodeTestToolRequest(name: string, input: unknown): TestToolRequest {
	switch (name) {
		case 'studio_list_test_runs': toolArguments(input, NO_FIELDS); return { name };
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
		default: throw new StudioToolInputError(`Unknown Studio test tool: ${name}`);
	}
}
