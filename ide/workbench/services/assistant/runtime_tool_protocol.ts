import { StudioToolInputError, toolArguments } from './tool_input';

export type RuntimeToolRequest =
	| { name: 'studio_runtime_status' }
	| { name: 'studio_pause_runtime' | 'studio_inspect_runtime'; target: string }
	| { name: 'studio_read_runtime_values'; reference: string; start: number; count: number };
const NO_FIELDS: string[] = [];
const TARGET_FIELDS = ['target'];
const VALUES_FIELDS = ['reference', 'start', 'count'];
const TARGET_SCHEMA = { type: 'object', properties: { target: { type: 'string' } }, required: TARGET_FIELDS, additionalProperties: false };

export const STUDIO_RUNTIME_TOOLS = [
	{ name: 'studio_runtime_status', description: 'Read the actual Studio authoring target identity, machine cycles/video tick and execution/inspection availability. No screenshot, guest execution or test-target attachment. Use on demand, not polling.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_pause_runtime', description: 'Pause the listed authoring target without changing guest state or other pause reasons. Leaves it user-paused after the conversation. Refuses an active machine operation; does not interrupt Lua or rewind.', inputSchema: TARGET_SCHEMA },
	{ name: 'studio_inspect_runtime', description: 'Open a suspended inspection of the listed authoring target. Returns installed BIOS and active-cartridge global binding scopes (not separate cartridge global banks). Names come from installed symbols, not unsaved source. Does not execute Lua. Replaces this prompt\'s prior inspection; all value references expire on execution, restore/reset or prompt retirement. Read tables with studio_read_runtime_values. Does not provide frame locals or test-target attachment.', inputSchema: TARGET_SCHEMA },
	{ name: 'studio_read_runtime_values', description: 'Read a page from a scope/table reference in this prompt\'s current suspended inspection. Zero-based start, positive count. Values and table keys retain guest kinds; displays are not lookup keys. Tables expose stored entries only, without executing metamethods. Repeated/cyclic tables share a reference. Number displays preserve guest formatting. A page past the end is empty, not missing values. Expired references require a new inspection.',
		inputSchema: { type: 'object', properties: { reference: { type: 'string' }, start: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: VALUES_FIELDS, additionalProperties: false } },
];

export function decodeRuntimeToolRequest(name: string, input: unknown): RuntimeToolRequest {
	switch (name) {
		case 'studio_runtime_status': toolArguments(input, NO_FIELDS); return { name };
		case 'studio_pause_runtime':
		case 'studio_inspect_runtime': {
			const value = toolArguments(input, TARGET_FIELDS);
			if (typeof value.target !== 'string') throw new StudioToolInputError('target must be the listed Studio runtime handle');
			return { name, target: value.target };
		}
		case 'studio_read_runtime_values': {
			const value = toolArguments(input, VALUES_FIELDS);
			if (typeof value.reference !== 'string' || !Number.isSafeInteger(value.start) || (value.start as number) < 0
				|| !Number.isSafeInteger(value.count) || (value.count as number) < 1) {
				throw new StudioToolInputError('Runtime values require a reference, non-negative integer start and positive integer count');
			}
			return { name, reference: value.reference, start: value.start as number, count: value.count as number };
		}
		default: throw new StudioToolInputError(`Unknown Studio runtime tool: ${name}`);
	}
}
