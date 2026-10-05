import { StudioToolInputError, toolArguments } from './tool_input';

export type EventToolRequest =
	| { name: 'studio_event_history'; target: string; action: 'status' | 'clear' }
	| { name: 'studio_read_events'; target: string; generation: number; sequence: number; count: number };
const HISTORY_FIELDS = ['target', 'action'];
const READ_FIELDS = ['target', 'generation', 'sequence', 'count'];

export const STUDIO_EVENT_TOOLS = [
	{ name: 'studio_event_history',
		description: 'Read the automatic recent Event Viewer history status or clear retained evidence on the authoring target. No Record/Start is needed. Debug builds select the source event.emit trace channel; release builds erase it. History belongs to the workspace, not pane/conversation lifetime, and is a bounded circular buffer. status reports generation, firstSequence, endSequence, total, capacity and expired count. clear deletes snapshots and invalidates generation without disabling collection. Replay does not duplicate emissions; reset, external load, installation or live branching starts a new labelled timeline; merely seeking or returning to the present does not. No guest execution, playback change or instruction hook. Read on demand, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, action: { type: 'string', enum: ['status', 'clear'] } }, required: HISTORY_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_events',
		description: 'Read historical event snapshots from the retained sequence window reported by studio_event_history. generation expires on clear. sequence is the first requested absolute sequence; count is positive. An expired sequence is reported, never substituted with different data. Events include sequence, timeline, execution domain, machine cycles, last completed tick, event, emitter and immutable payload. Snapshots carry kind and typed value fields, not UI display strings. Tables carry id, entries (typed key/value pairs) and omitted; references/functions/threads/builtins carry id. Number values are exact; -0, nan and +/-inf use explicit string spellings within kind:number for lossless JSON. Tables are bounded to depth 3 and 64 stored entries, string content to 4096 code units per emission. The shared scan budget visits at most 1024 table storage positions, including vacant/dead slots. omitted marks incomplete inspection, not a known count of missing entries. No live guest references, execution or inferred handler completion. Old timelines remain distinguishable after reset/live branch/install.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, sequence: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: READ_FIELDS, additionalProperties: false } },
];

/** External model arguments are decoded here; runtime history consumes its own representation. */
export function decodeEventToolRequest(name: string, input: unknown): EventToolRequest {
	if (name === 'studio_event_history') {
		const value = toolArguments(input, HISTORY_FIELDS);
		if (typeof value.target !== 'string' || value.action !== 'status' && value.action !== 'clear') {
			throw new StudioToolInputError('Event history requires the target and status/clear action');
		}
		return { name, target: value.target, action: value.action };
	}
	if (name === 'studio_read_events') {
		const value = toolArguments(input, READ_FIELDS);
		if (typeof value.target !== 'string' || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
			|| !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 || !Number.isSafeInteger(value.count) || (value.count as number) < 1) {
			throw new StudioToolInputError('Event reads require the target, non-negative generation/sequence and positive count');
		}
		return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number, count: value.count as number };
	}
	throw new StudioToolInputError(`Unknown Studio event tool: ${name}`);
}
