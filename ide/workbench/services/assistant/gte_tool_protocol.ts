import type { GteCommandSnapshot } from '../../../runtime/gte_history';
import { blua32SourceRangeAtPc } from '../../../../toolchain/ts/rompack/blua32_symbols';
import { StudioToolInputError, toolArguments } from './tool_input';

export type GteToolRequest =
	| { name: 'studio_gte_history'; target: string; action: 'status' | 'start' | 'stop' | 'clear' }
	| { name: 'studio_read_gte_commands'; target: string; generation: number; sequence: number; count: number }
	| { name: 'studio_seek_gte_command'; target: string; generation: number; sequence: number };
const HISTORY_FIELDS = ['target', 'action'];
const SEEK_FIELDS = ['target', 'generation', 'sequence'];
const READ_FIELDS = ['target', 'generation', 'sequence', 'count'];

export const STUDIO_GTE_TOOLS = [
	{ name: 'studio_gte_history',
		description: 'Inspect, start, stop or clear bounded evidence of actual normal GTE COMMAND writes on this authoring target. Observation is optional and initially disabled. start acquires one observation lease owned by this tool context; repeated start is idempotent. stop or context disposal releases only that lease, never an open GTE pane or another client. A new session after the final observer stopped clears old evidence and changes generation, so unobserved gaps are not presented as continuous capture. clear deletes shared evidence and changes generation without releasing observers. Status reports observing, observingInContext, generation, firstSequence, endSequence, total, capacity and expired. No guest execution, MMIO reads, device writes, command reexecution or extra guest cycles. Replay/review does not duplicate commands; PLUS deferred commands are not captured. Use existing debugger or frame tools for execution, then read on demand, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, action: { type: 'string', enum: ['status', 'start', 'stop', 'clear'] } }, required: HISTORY_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_gte_commands',
		description: 'Read actual captured GTE command invocations by generation and absolute sequence from studio_gte_history. count is positive; reads stop at the published end. Cleared generations, expired sequences and positions beyond that end are rejected, never substituted. Each detached command includes sequence, timeline, full machine cycles, last completed tick, raw commandWord, nominalCycles, busSignals, canSeek, optional CPU source domain/PC and mapped location, and four 32-word arrays: beforeData, beforeControl, afterData, afterControl. source.origin is installed for admitted image code, or instruction for RAM/unmapped code without installed source identity; host/DMA writes have no CPU source. These are raw backing words: D15 is not the SXY2 read alias, and D28/D29 are not derived IRGB/ORGB port values. Signed lanes and fixed-point meaning belong to the operation; there is no universal float scale. RTPT retains three SXY/SZ results but only the final vertex MAC/IR and aggregate FLAG. Later lighting operands do not replace this captured invocation. nominalCycles is not elapsed time. No source image, guest objects or live references are serialized. Reading does not start observation or execute the target.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, sequence: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: READ_FIELDS, additionalProperties: false } },
	{ name: 'studio_seek_gte_command',
		description: 'Navigate by captured GTE command generation/sequence to its reachable retained video boundary at or before the command cycles. Uses actual recording/checkpoint provenance, not a guessed timestamp. Rejects cleared or expired command identities, discarded branch futures, replaced recordings and unreachable history. This is frame-granularity navigation, NOT an exact COMMAND instruction stop; selected captured evidence and the reconstructed current GTE state are distinct. Awaits the shared navigation result, requestedCommandCycles and actual before/after positions, leaves review paused and preserves future input. Cancellation retires only this navigation operation. Does not start recording or observation, reexecute GTE independently or create another execution loop.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, generation: { type: 'integer', minimum: 0 }, sequence: { type: 'integer', minimum: 0 } }, required: SEEK_FIELDS, additionalProperties: false } },
];

/** External tool input is admitted here, not revalidated by the history owner. */
export function decodeGteToolRequest(name: string, input: unknown): GteToolRequest {
	if (name === 'studio_gte_history') {
		const value = toolArguments(input, HISTORY_FIELDS);
		if (typeof value.target !== 'string' || value.action !== 'status' && value.action !== 'start'
			&& value.action !== 'stop' && value.action !== 'clear') {
			throw new StudioToolInputError('GTE history requires the target and status/start/stop/clear action');
		}
		return { name, target: value.target, action: value.action };
	}
	if (name === 'studio_read_gte_commands' || name === 'studio_seek_gte_command') {
		const value = toolArguments(input, name === 'studio_read_gte_commands' ? READ_FIELDS : SEEK_FIELDS);
		if (typeof value.target !== 'string' || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
			|| !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
			throw new StudioToolInputError('GTE command access requires the target and non-negative generation/sequence');
		}
		if (name === 'studio_seek_gte_command') return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number };
		if (!Number.isSafeInteger(value.count) || (value.count as number) < 1) throw new StudioToolInputError('GTE command reads require a positive count');
		return { name, target: value.target, generation: value.generation as number, sequence: value.sequence as number, count: value.count as number };
	}
	throw new StudioToolInputError(`Unknown Studio GTE tool: ${name}`);
}

/** The wire owns detached raw words and source locations, never installed media. */
export function encodeGteCommand(record: GteCommandSnapshot, canSeek: boolean) {
	const image = record.image;
	const range = image === null || image.symbols === null ? null
		: blua32SourceRangeAtPc(image.symbols, image.layout.header.textAddress, record.pc!);
	return { sequence: record.sequence, timeline: record.timeline, cycles: record.cycles, completedTick: record.completedTick,
		commandWord: record.commandWord, nominalCycles: record.nominalCycles, busSignals: record.busSignals, canSeek,
		source: record.domain === undefined ? undefined : { origin: image === null ? 'instruction' as const : 'installed' as const, domain: record.domain, pc: record.pc,
			symbols: image !== null && image.symbols !== null,
			location: range === null ? undefined : { path: range.path,
				start: { line: range.start.line, column: range.start.column }, end: { line: range.end.line, column: range.end.column } } },
		beforeData: Array.from(record.beforeData), beforeControl: Array.from(record.beforeControl),
		afterData: Array.from(record.afterData), afterControl: Array.from(record.afterControl) };
}
