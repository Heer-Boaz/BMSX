import { normalizeLuaChunkName } from '../../lua/debugger';
import { clamp } from '../../utils/clamp';;
import { getDebuggerRuntimeAccessor } from '../runtime_accessors';
import { resolveHoverChunkName } from './intellisense';
import * as constants from './constants';
import { getActiveCodeTabContext } from './editor_tabs';
import { ide_state } from './ide_state';

export type SerializedBreakpointMap = Record<string, number[]>;

export type BreakpointToggleResult = 'added' | 'removed' | 'unchanged';

function normalizeChunkKey(chunkName: string): string {
	return normalizeLuaChunkName(chunkName);
}

function ensureBucket(chunkKey: string): Set<number> {
	let bucket = ide_state.breakpoints.get(chunkKey);
	if (!bucket) {
		bucket = new Set<number>();
		ide_state.breakpoints.set(chunkKey, bucket);
	}
	return bucket;
}

function cleanupBucket(chunkKey: string, bucket: Set<number>): void {
	if (bucket.size === 0) {
		ide_state.breakpoints.delete(chunkKey);
	}
}

function toLineNumber(line: number): number | null {
	if (!Number.isFinite(line)) {
		return null;
	}
	return clamp(Math.floor(line), 1, Number.MAX_SAFE_INTEGER);
}

export function hasBreakpoint(chunkName: string | null, line: number): boolean {
	if (!chunkName) {
		return false;
	}
	const normalizedLine = toLineNumber(line);
	if (normalizedLine === null) {
		return false;
	}
	const bucket = ide_state.breakpoints.get(normalizeChunkKey(chunkName));
	return bucket?.has(normalizedLine) === true;
}

export function getBreakpointsForChunk(chunkName: string | null): ReadonlySet<number> | null {
	if (!chunkName) {
		return null;
	}
	const bucket = ide_state.breakpoints.get(normalizeChunkKey(chunkName));
	return bucket ?? null;
}

export function toggleBreakpoint(chunkName: string, line: number): BreakpointToggleResult {
	const normalizedLine = toLineNumber(line);
	if (normalizedLine === null) {
		return 'unchanged';
	}
	const chunkKey = normalizeChunkKey(chunkName);
	const bucket = ensureBucket(chunkKey);
	if (bucket.has(normalizedLine)) {
		bucket.delete(normalizedLine);
		cleanupBucket(chunkKey, bucket);
		syncRuntimeBreakpoints();
		return 'removed';
	}
	bucket.add(normalizedLine);
	syncRuntimeBreakpoints();
	return 'added';
}

export function serializeBreakpoints(): SerializedBreakpointMap {
	const payload: SerializedBreakpointMap = {};
	for (const [chunk, lines] of ide_state.breakpoints) {
		if (lines.size === 0) {
			continue;
		}
		const sorted = Array.from(lines).sort((a, b) => a - b);
		payload[chunk] = sorted;
	}
	return payload;
}

export function restoreBreakpointsFromPayload(payload: SerializedBreakpointMap | null | undefined): void {
	ide_state.breakpoints.clear();
	if (payload) {
		for (const [chunk, lineEntries] of Object.entries(payload)) {
			if (!Array.isArray(lineEntries) || lineEntries.length === 0) {
				continue;
			}
			const chunkKey = normalizeChunkKey(chunk);
			const bucket = new Set<number>();
			for (const entry of lineEntries) {
				const normalizedLine = toLineNumber(entry);
				if (normalizedLine !== null) {
					bucket.add(normalizedLine);
				}
			}
			if (bucket.size > 0) {
				ide_state.breakpoints.set(chunkKey, bucket);
			}
		}
	}
	syncRuntimeBreakpoints();
}

export function syncRuntimeBreakpoints(): void {
	const accessor = getDebuggerRuntimeAccessor();
	if (!accessor) {
		return;
	}
	const runtime = accessor() as { setLuaBreakpoints?(breakpoints: ReadonlyMap<string, ReadonlySet<number>>): void } | null | undefined;
	if (!runtime || typeof runtime.setLuaBreakpoints !== 'function') {
		return;
	}
	const serialized = new Map<string, ReadonlySet<number>>();
	for (const [chunk, lines] of ide_state.breakpoints) {
		if (lines.size === 0) {
			continue;
		}
		serialized.set(chunk, new Set(lines));
	}
	runtime.setLuaBreakpoints(serialized);
}
export function getActiveBreakpointChunkName(): string | null {
	const context = getActiveCodeTabContext();
	return resolveHoverChunkName(context);
}

export function toggleBreakpointForEditorRow(row: number): boolean {
	if (row < 0 || row >= ide_state.lines.length) {
		return false;
	}
	const chunkName = getActiveBreakpointChunkName();
	if (!chunkName) {
		ide_state.showMessage('No active chunk available for breakpoints.', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const lineNumber = row + 1;
	const result = toggleBreakpoint(chunkName, lineNumber);
	if (result === 'unchanged') {
		return false;
	}
	const verb = result === 'added' ? 'set' : 'cleared';
	ide_state.showMessage(`Breakpoint ${verb} at ${chunkName}:${lineNumber}`, constants.COLOR_STATUS_TEXT, 1.4);
	return true;
}

export function toggleBreakpointAtCursor(): void {
	void toggleBreakpointForEditorRow(ide_state.cursorRow);
}
