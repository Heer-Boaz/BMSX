import { StudioToolInputError, toolArguments } from './tool_input';

export type EventToolRequest =
	| { name: 'studio_event_history'; target: string; action: 'status' | 'clear' }
	| { name: 'studio_read_events'; target: string; generation: number; sequence: number; count: number }
	| { name: 'studio_seek_event'; target: string; generation: number; sequence: number };
const HISTORY_FIELDS = ['target', 'action'];
const SEEK_FIELDS = ['target', 'generation', 'sequence'];
const READ_FIELDS = ['target', 'generation', 'sequence', 'count'];

export const STUDIO_EVENT_TOOLS = [
	{ name: 'studio_event_history',
		description: 'Read the automatic recent Event Viewer history status or clear retained evidence on the authoring target. No Record/Start is needed. Installed source symbols bind read-only host observation points; debug and release guest execution is identical. History belongs to the workspace, not pane/conversation lifetime, and is a bounded circular buffer. status reports generation, firstSequence, endSequence, total, capacity and expired count. clear deletes snapshots and invalidates generation without disabling collection. Replay does not duplicate emissions; reset, external load, installation or live branching starts a new labelled timeline; merely seeking or returning to the present does not. Reading history causes no guest execution or playback change. Read on demand, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, action: { type: 'string', enum: ['status', 'clear'] } }, required: HISTORY_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_events',
		description: 'Read historical event snapshots from the retained sequence window reported by studio_event_history. generation expires on clear. sequence is the first requested absolute sequence; count is positive. An expired sequence is reported, never substituted with different data. Events include sequence, timeline, execution domain, machine cycles, last completed tick, event, emitter and immutable payload. Snapshots carry kind and typed value fields, not UI display strings. Tables carry id, entries (typed key/value pairs) and omitted; references/functions/threads/builtins carry id. Number values are exact; -0, nan and +/-inf use explicit string spellings within kind:number for lossless JSON. Tables are bounded to depth 3 and 64 stored entries, string content to 4096 code units per emission. The shared scan budget visits at most 1024 table storage positions, including vacant/dead slots. omitted marks incomplete inspection, not a known count of missing entries. No live guest references, execution or inferred handler completion. Old timelines remain distinguishable after reset/live branch/install. Use studio_seek_event to navigate by event identity; copying cycles into studio_seek_history cannot establish that old evidence belongs to the retained physical recording.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, sequence: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: READ_FIELDS, additionalProperties: false } },
	{ name: 'studio_seek_event',
		description: 'Navigate to the retained video boundary at or before a historical event emission on the authoring target. Takes the generation and event sequence from studio_read_events, not an inferred timestamp or emitter identity. Rejects cleared/expired events, discarded branch futures, replaced recordings and positions outside retained history. Valid pre-branch evidence remains reachable. This is frame-granularity navigation, NOT an exact event instruction stop or completion of its handlers. Leaves the machine paused and awaits the shared navigation outcome, with requested emission cycles and actual before/after video ticks/cycles. Preserves event evidence and recorded future. Request cancellation retires only this operation. No polling or extra recording session.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, sequence: { type: 'integer', minimum: 0 } }, required: SEEK_FIELDS, additionalProperties: false } },
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
	if (name === 'studio_read_events' || name === 'studio_seek_event') {
		const value = toolArguments(input, name === 'studio_read_events' ? READ_FIELDS : SEEK_FIELDS);
		if (typeof value.target !== 'string' || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
			|| !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
			throw new StudioToolInputError('Event access requires the target and non-negative generation/sequence');
		}
		if (name === 'studio_seek_event') return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number };
		if (!Number.isSafeInteger(value.count) || (value.count as number) < 1) throw new StudioToolInputError('Event reads require a positive count');
		return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number, count: value.count as number };
	}
	throw new StudioToolInputError(`Unknown Studio event tool: ${name}`);
}
