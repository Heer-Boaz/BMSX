import { StudioToolInputError, toolArguments } from './tool_input';

export type EventToolRequest =
	| { name: 'studio_event_capture'; target: string; action: 'status' | 'start' | 'stop' | 'clear' }
	| { name: 'studio_read_events'; target: string; generation: number; start: number; count: number };
const CAPTURE_FIELDS = ['target', 'action'];
const READ_FIELDS = ['target', 'generation', 'start', 'count'];

export const STUDIO_EVENT_TOOLS = [
	{ name: 'studio_event_capture',
		description: 'Control or inspect the shared Event Viewer recording on the authoring target. start observes cartlib/event_emitter emission before listener dispatch through installed debug symbols; it does not run or resume the game, add guest listeners, or modify cartlib. Recording has host overhead and stops at buffer capacity, code install, reset or history restore. History review cannot be recorded. stop retains immutable snapshots; clear deletes them and advances generation without stopping active recording. Recording is workspace-owned, survives tool-context retirement and stops when the viewer is closed. Returns status, generation, total and capacity. Use explicit start/stop around the operation being investigated, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, action: { type: 'string', enum: ['status', 'start', 'stop', 'clear'] } }, required: CAPTURE_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_events',
		description: 'Read a page of historical emission snapshots from the Event Viewer generation reported by studio_event_capture. start is a zero-based index; count is positive. A clear expires that generation. Each event has sequence, capture, domain, exact machine cycles, last completed tick, event name, emitter ID and stored-value payload. Snapshots survive later mutation/reset but are not live value handles. Tables are bounded to depth 3 and 64 total entries; string content to 4096 code units per emission. Omitted contents are explicitly marked. Captures have independent timelines; no inference of handler completion or unrecorded events. No guest execution or suspended inspection required.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, start: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: READ_FIELDS, additionalProperties: false } },
];

/** External model arguments are decoded here; runtime capture consumes its own representation. */
export function decodeEventToolRequest(name: string, input: unknown): EventToolRequest {
	if (name === 'studio_event_capture') {
		const value = toolArguments(input, CAPTURE_FIELDS);
		if (typeof value.target !== 'string' || value.action !== 'status' && value.action !== 'start' && value.action !== 'stop' && value.action !== 'clear') {
			throw new StudioToolInputError('Event capture requires the target and status/start/stop/clear action');
		}
		return { name, target: value.target, action: value.action };
	}
	if (name === 'studio_read_events') {
		const value = toolArguments(input, READ_FIELDS);
		if (typeof value.target !== 'string' || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
			|| !Number.isSafeInteger(value.start) || (value.start as number) < 0 || !Number.isSafeInteger(value.count) || (value.count as number) < 1) {
			throw new StudioToolInputError('Event reads require the target, non-negative generation/start and positive count');
		}
		return { name, target: value.target, generation: value.generation as number, start: value.start as number, count: value.count as number };
	}
	throw new StudioToolInputError(`Unknown Studio event tool: ${name}`);
}
