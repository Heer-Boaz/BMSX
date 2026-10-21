import type { GpuOperationRecord } from '../../../runtime/gpu_history';
import { StudioToolInputError, toolArguments } from './tool_input';

export type GpuToolRequest =
	| { name: 'studio_gpu_history'; target: string; action: 'status' | 'start' | 'stop' | 'clear' }
	| { name: 'studio_read_gpu_operations'; target: string; generation: number; sequence: number; count: number }
	| { name: 'studio_read_gpu_words'; target: string; generation: number; sequence: number; offset: number; count: number }
	| { name: 'studio_seek_gpu_operation'; target: string; generation: number; sequence: number };
const HISTORY_FIELDS = ['target', 'action'];
const SEEK_FIELDS = ['target', 'generation', 'sequence'];
const READ_FIELDS = ['target', 'generation', 'sequence', 'count'];
const WORD_FIELDS = ['target', 'generation', 'sequence', 'offset', 'count'];
const ID_SCHEMA = { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, sequence: { type: 'integer', minimum: 0 } };
export const STUDIO_GPU_TOOLS = [
	{ name: 'studio_gpu_history', description: 'Inspect/start/stop/clear optional bounded evidence of emitted GPU raster/transfer operations on this authoring target. start acquires one idempotent tool-context lease; stop or context disposal releases only that lease. Reopening after the last observer stopped clears evidence and changes generation. Ring and raw-word arena evict whole operations; status reports generation, firstSequence/endSequence, total, capacity, wordCount/wordCapacity and expired. No guest execution, GPU synchronization, register reads or device writes. Replay/review does not duplicate evidence. These are operations observed at execution start, NOT completed/presented work or complete GP0/GP1 bus traffic. Environment writes are represented by retained per-operation drawing state, polylines by parser-emitted segments. No CPU producer PC or GTE ancestry is inferred. Read on demand, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, action: { type: 'string', enum: ['status', 'start', 'stop', 'clear'] } }, required: HISTORY_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_gpu_operations', description: 'Read detached GPU operation metadata by current generation and absolute sequence from studio_gpu_history. count is positive; the page stops at published end. Expired/cleared identities are rejected. Returns kind/opcode, actual observation cycles, logical device startCycles (which can precede observation during catch-up), completedTick, canSeek and raw retained drawModeWord, vramYAddressExtensionWord, textureWindowWord, drawingAreaTopLeftWord/BottomRightWord, drawingOffsetWord, maskBitModeWord and skippedLineParity. wordCount is the exact retained operation length, not snapshot capacity; fetch raw words with studio_read_gpu_words. Uploads may contain only the consumed prefix even when their original header describes a larger image. Records neither establish visibility in scanout nor retain historical texture pixels. No source/media/guest-object references or guessed current-state substitutes are returned.',
		inputSchema: { type: 'object', properties: { ...ID_SCHEMA, count: { type: 'integer', minimum: 1 } }, required: READ_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_gpu_words', description: 'Read an explicit page of raw retained words of one GPU operation. offset is zero-based, count positive; reads stop at that operation wordCount and report nextOffset. An offset beyond wordCount is rejected. No implicit truncation to a short header, stale capacity padding or reconstruction of missing upload words. Expired/cleared identities are rejected. Polygon/line/rectangle words retain the actual parsed parameters; polyline continuation is a normalized segment, not an original standalone bus packet. Raw transfer payload is retained as received, including a partially flushed upload prefix. No GPU synchronization, guest execution or reads of today\'s VRAM.',
		inputSchema: { type: 'object', properties: { ...ID_SCHEMA, offset: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: WORD_FIELDS, additionalProperties: false } },
	{ name: 'studio_seek_gpu_operation', description: 'Await shared frame-history navigation to a retained video boundary at or before the GPU operation actual OBSERVATION cycles, using its original checkpoint provenance. This can be later than logical startCycles; it is not an exact packet start/completion stop or draw replay. Rejects expired/cleared operation identities and unreachable or discarded recording branches. Leaves review paused, preserves future input and returns requestedObservationCycles and actual before/after positions. Selected evidence remains distinct from reconstructed device state. Cancellation retires only this navigation operation; no second runtime loop or independent rendering.',
		inputSchema: { type: 'object', properties: ID_SCHEMA, required: SEEK_FIELDS, additionalProperties: false } },
];

/** Only external requests are validated; producers and internal consumers share raw representations. */
export function decodeGpuToolRequest(name: string, input: unknown): GpuToolRequest {
	if (name === 'studio_gpu_history') {
		const value = toolArguments(input, HISTORY_FIELDS);
		if (typeof value.target !== 'string' || value.action !== 'status' && value.action !== 'start' && value.action !== 'stop' && value.action !== 'clear') throw new StudioToolInputError('GPU history requires the target and status/start/stop/clear action');
		return { name, target: value.target, action: value.action };
	}
	if (name === 'studio_read_gpu_operations' || name === 'studio_read_gpu_words' || name === 'studio_seek_gpu_operation') {
		const value = toolArguments(input, name === 'studio_seek_gpu_operation' ? SEEK_FIELDS : name === 'studio_read_gpu_words' ? WORD_FIELDS : READ_FIELDS);
		if (typeof value.target !== 'string' || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0 || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) throw new StudioToolInputError('GPU operation access requires the target and non-negative generation/sequence');
		if (name === 'studio_seek_gpu_operation') return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number };
		if (!Number.isSafeInteger(value.count) || (value.count as number) < 1) throw new StudioToolInputError('GPU reads require a positive count');
		if (name === 'studio_read_gpu_operations') return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number, count: value.count as number };
		if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0) throw new StudioToolInputError('GPU word reads require a non-negative offset');
		return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number, offset: value.offset as number, count: value.count as number };
	}
	throw new StudioToolInputError(`Unknown Studio GPU tool: ${name}`);
}

export function encodeGpuOperation(record: Readonly<GpuOperationRecord>, canSeek: boolean) {
	return { sequence: record.sequence, timeline: record.timeline, cycles: record.cycles, startCycles: record.startCycles,
		completedTick: record.completedTick, kind: record.kind, opcode: record.opcode, wordCount: record.wordCount, canSeek,
		drawModeWord: record.drawModeWord, vramYAddressExtensionWord: record.vramYAddressExtensionWord,
		textureWindowWord: record.textureWindowWord, drawingAreaTopLeftWord: record.drawingAreaTopLeftWord,
		drawingAreaBottomRightWord: record.drawingAreaBottomRightWord, drawingOffsetWord: record.drawingOffsetWord,
		maskBitModeWord: record.maskBitModeWord, skippedLineParity: record.skippedLineParity };
}
