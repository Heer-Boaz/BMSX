import { StudioToolInputError, toolArguments } from './tool_input';
import { decodeTerminalToolRequest, STUDIO_TERMINAL_TOOLS, type TerminalToolRequest } from './terminal_tool_protocol';

export type RuntimeToolRequest =
	| TerminalToolRequest
	| { name: 'studio_runtime_status' }
	| { name: 'studio_pause_runtime' | 'studio_inspect_runtime' | 'studio_capture_game'; target: string }
	| { name: 'studio_step_frames'; target: string; direction: -1 | 1; count: number }
	| { name: 'studio_seek_history'; target: string; cycles: number }
	| { name: 'studio_read_runtime_values'; reference: string; start: number; count: number };
const NO_FIELDS: string[] = [];
const TARGET_FIELDS = ['target'];
const STEP_FIELDS = ['target', 'direction', 'count'];
const SEEK_FIELDS = ['target', 'cycles'];
const VALUES_FIELDS = ['reference', 'start', 'count'];
const TARGET_SCHEMA = { type: 'object', properties: { target: { type: 'string' } }, required: TARGET_FIELDS, additionalProperties: false };

export const STUDIO_RUNTIME_TOOLS = [
	...STUDIO_TERMINAL_TOOLS,
	{ name: 'studio_step_frames', description: 'Advance or rewind an explicit number of physical video boundaries on the authoring target. Awaits completed/stopped/interrupted/replaced/failed outcome with actual before/after cycles and video ticks; not merely command acceptance. Keeps the target paused and preserves recorded input/future. Forward stepping beyond the recording end executes live input. Stops at retained-history start, debugger stop or guest fault. Not source/instruction stepping or a guarantee that gameplay ran once per video tick. No polling is needed; conversation Stop cancels owned navigation.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, direction: { type: 'string', enum: ['forward', 'backward'] }, count: { type: 'integer', minimum: 1 } }, required: STEP_FIELDS, additionalProperties: false } },
	{ name: 'studio_seek_history', description: 'Seek within the authoring target\'s retained cycle range from studio_runtime_status.history. Selects the retained video boundary at or before the requested cycles; returns requested and actual positions after reconstruction settles. Rejects cycles outside retention rather than silently clamping. Preserves the recorded future and leaves review paused. Awaits completion or an explicit stop/interruption/failure; do not poll.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, cycles: { type: 'integer', minimum: 0 } }, required: SEEK_FIELDS, additionalProperties: false } },
	{ name: 'studio_capture_game', description: 'See the retained completed game frame of a paused, idle authoring target as an image. Native scanout size, after device quantization and before CRT/IDE overlays. Returns frame-publication cycles/video tick separately from the current machine observation: the last completed image can precede the stopped CPU. Does not run the guest, refresh the frame or capture the chat UI. Use on demand, not polling.', inputSchema: TARGET_SCHEMA },
	{ name: 'studio_runtime_status', description: 'Read the actual Studio authoring target identity, machine cycles/video tick, execution/inspection availability and retained-history range with frame-navigation availability. No screenshot, guest execution or test-target attachment. Use on demand, not polling.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_pause_runtime', description: 'Pause the listed authoring target without changing guest state or other pause reasons. Leaves it user-paused after the conversation. Refuses an active machine operation; does not interrupt Lua or rewind.', inputSchema: TARGET_SCHEMA },
	{ name: 'studio_inspect_runtime', description: 'Open a suspended inspection of the listed authoring target. Returns installed BIOS and active-cartridge global binding scopes (not separate cartridge global banks). Names come from installed symbols, not unsaved source. Does not execute Lua. Replaces this prompt\'s prior inspection; all value references expire on execution, restore/reset or prompt retirement. Read tables with studio_read_runtime_values. Does not provide frame locals or test-target attachment.', inputSchema: TARGET_SCHEMA },
	{ name: 'studio_read_runtime_values', description: 'Read a page from a scope/table reference in this prompt\'s current suspended inspection. Zero-based start, positive count. Values and table keys retain guest kinds; displays are not lookup keys. Tables expose stored entries only, without executing metamethods. Repeated/cyclic tables share a reference. Number displays preserve guest formatting. A page past the end is empty, not missing values. Expired references require a new inspection.',
		inputSchema: { type: 'object', properties: { reference: { type: 'string' }, start: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: VALUES_FIELDS, additionalProperties: false } },
];

export function decodeRuntimeToolRequest(name: string, input: unknown): RuntimeToolRequest {
	switch (name) {
		case 'studio_runtime_status': toolArguments(input, NO_FIELDS); return { name };
		case 'studio_step_frames': {
			const value = toolArguments(input, STEP_FIELDS);
			if (typeof value.target !== 'string' || value.direction !== 'forward' && value.direction !== 'backward'
				|| !Number.isSafeInteger(value.count) || (value.count as number) < 1) {
				throw new StudioToolInputError('Frame steps require the target, forward/backward direction and a positive integer count');
			}
			return { name, target: value.target, direction: value.direction === 'forward' ? 1 : -1, count: value.count as number };
		}
		case 'studio_seek_history': {
			const value = toolArguments(input, SEEK_FIELDS);
			if (typeof value.target !== 'string' || !Number.isSafeInteger(value.cycles) || (value.cycles as number) < 0) {
				throw new StudioToolInputError('History seek requires the target and non-negative integer machine cycles');
			}
			return { name, target: value.target, cycles: value.cycles as number };
		}
		case 'studio_pause_runtime':
		case 'studio_capture_game':
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
		default: return decodeTerminalToolRequest(name, input);
	}
}
