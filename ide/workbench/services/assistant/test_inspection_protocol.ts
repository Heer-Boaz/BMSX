import { StudioToolInputError, toolArguments } from './tool_input';

export type TestInspectionRequest =
	| { name: 'studio_inspect_test_target'; result: string }
	| { name: 'studio_read_test_stack'; stack: string; start: number; count: number }
	| { name: 'studio_read_test_frame_scopes' | 'studio_read_test_frame_source'; frame: string }
	| { name: 'studio_read_test_values'; reference: string; start: number; count: number };
const RESULT_FIELDS = ['result'], STACK_FIELDS = ['stack', 'start', 'count'], FRAME_FIELDS = ['frame'], VALUE_FIELDS = ['reference', 'start', 'count'];
const PAGE = { start: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } };
const FRAME_SCHEMA = { type: 'object', properties: { frame: { type: 'string' } }, required: FRAME_FIELDS, additionalProperties: false };
export const STUDIO_TEST_INSPECTION_TOOLS = [
	{ name: 'studio_inspect_test_target', description: 'Attach read-only to the actual retained failed test machine for a listed case. Returns failure-thread handles and global scopes. Only the most recently retained failed target is available; historical evidence alone cannot attach. Replaces this prompt\'s prior test inspection. This is post-mortem, at case end: failed frames survive, shared tables/globals may have changed during teardown. Not a fault-time heap snapshot, authoring runtime, live test debugger or evaluator. Cannot resume, step or execute Terminal on a failed thread. Handles expire on target replacement/disposal or prompt retirement.',
		inputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: RESULT_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_test_stack', description: 'Read a page of a test stack from a retained failure or current live stop, top first. The supplied stack handle belongs to the open test inspection. Never substitutes the current/authoring CPU. Physical domain, address and PC remain machine values; resource domain identifies the original authored socket. Source locations are one-based and refer to the compiled test images, not current working copies. Inline and recursive frames have distinct handles. Zero-based start, positive count.',
		inputSchema: { type: 'object', properties: { stack: { type: 'string' }, ...PAGE }, required: STACK_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_test_frame_scopes', description: 'Read locals/upvalue scope handles for a frame from the inspected test stack. Actual frame register windows and closure captures, with compiler liveness: optimized/unavailable locations are explicit, not nil. Inline frames have no separate closure. Read values with studio_read_test_values; no Lua evaluation.', inputSchema: FRAME_SCHEMA },
	{ name: 'studio_read_test_frame_source', description: 'Read the exact compiled source of a inspected test frame, including accepted unsaved test/dependency text or BIOS/companion ROM source. Never reads a newer editor model in its place. Instruction-only frames explicitly report unmapped source. No edit or save authority.', inputSchema: FRAME_SCHEMA },
	{ name: 'studio_read_test_values', description: 'Page a test scope or stored table entries. Guest kinds and typed keys are preserved; cyclic tables share a reference. Local/upvalue entries carry isConst for the compiled binding, independently of location availability; this does not freeze table contents. No metamethods or Lua code run. The inspection states whether values belong to a current debugger stop or the case-end retained heap; the latter is not the historical failure instant. Live handles expire on resume. Zero-based start, positive count; a page past the end is empty.',
		inputSchema: { type: 'object', properties: { reference: { type: 'string' }, ...PAGE }, required: VALUE_FIELDS, additionalProperties: false } },
];

export function decodeTestInspectionRequest(name: string, input: unknown): TestInspectionRequest {
	switch (name) {
		case 'studio_inspect_test_target': {
			const value = toolArguments(input, RESULT_FIELDS);
			if (typeof value.result !== 'string') throw new StudioToolInputError('result must be a listed case handle');
			return { name, result: value.result };
		}
		case 'studio_read_test_frame_scopes': case 'studio_read_test_frame_source': {
			const value = toolArguments(input, FRAME_FIELDS);
			if (typeof value.frame !== 'string') throw new StudioToolInputError('frame must be a handle from the inspected test stack');
			return { name, frame: value.frame };
		}
		case 'studio_read_test_stack': case 'studio_read_test_values': {
			const stack = name === 'studio_read_test_stack', value = toolArguments(input, stack ? STACK_FIELDS : VALUE_FIELDS);
			const reference = stack ? value.stack : value.reference;
			if (typeof reference !== 'string' || !Number.isSafeInteger(value.start) || (value.start as number) < 0
				|| !Number.isSafeInteger(value.count) || (value.count as number) < 1) {
				throw new StudioToolInputError('Test inspection reads require a handle, non-negative integer start and positive integer count');
			}
			return name === 'studio_read_test_stack'
				? { name, stack: reference, start: value.start as number, count: value.count as number }
				: { name, reference, start: value.start as number, count: value.count as number };
		}
		default: throw new StudioToolInputError(`Unknown Studio test inspection tool: ${name}`);
	}
}
