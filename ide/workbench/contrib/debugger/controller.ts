import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import { showEditorMessage } from '../../../common/feedback_state';
import { getActiveCodeTabContext } from '../../ui/code_tab/contexts';
import * as constants from '../../../common/constants';
import { editorDocumentState } from '../../../editor/editing/document_state';

export class BreakpointController {
	public revision = 0;

	public constructor(private readonly state: RuntimeDebuggerState) {}

	public toggleBreakpointForEditorRow(row: number = editorDocumentState.cursorRow): boolean {
		if (row < 0 || row >= editorDocumentState.buffer.getLineCount()) {
			return false;
		}
		const path = getActiveCodeTabContext().resource.path;
		if (!path) {
			showEditorMessage('No active path available for breakpoints.', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const lineNumber = row + 1;
		const result = toggleBreakpoint(this.state, path, lineNumber);
		if (result === 'unchanged') {
			return false;
		}
		this.revision += 1;
		const verb = result === 'added' ? 'set' : 'cleared';
		showEditorMessage(`Breakpoint ${verb} at ${path}:${lineNumber}`, constants.COLOR_STATUS_TEXT, 1.4);
		return true;
	}
}

export type SerializedBreakpointMap = Record<string, number[]>;

export type BreakpointToggleResult = 'added' | 'removed' | 'unchanged';
const EMPTY_BREAKPOINTS: ReadonlySet<number> = new Set<number>();

function ensureBucket(debuggerState: RuntimeDebuggerState, pathKey: string): Set<number> {
	let bucket = debuggerState.breakpoints.get(pathKey);
	if (!bucket) {
		bucket = new Set<number>();
		debuggerState.breakpoints.set(pathKey, bucket);
	}
	return bucket;
}

export function getBreakpointsForChunk(
	debuggerState: RuntimeDebuggerState,
	path: string,
): ReadonlySet<number> {
	if (!path) {
		return EMPTY_BREAKPOINTS;
	}
	const bucket = debuggerState.breakpoints.get(path);
	return bucket || EMPTY_BREAKPOINTS;
}

export function toggleBreakpoint(
	debuggerState: RuntimeDebuggerState,
	path: string,
	line: number,
): BreakpointToggleResult {
	if (line < 1) {
		return 'unchanged';
	}
	const pathKey = path;
	const bucket = ensureBucket(debuggerState, pathKey);
	if (bucket.has(line)) {
		bucket.delete(line);
		if (bucket.size === 0) {
			debuggerState.breakpoints.delete(pathKey);
		}
		return 'removed';
	}
	bucket.add(line);
	return 'added';
}

export function serializeBreakpoints(debuggerState: RuntimeDebuggerState): SerializedBreakpointMap {
	const payload: SerializedBreakpointMap = {};
	for (const [path, lines] of debuggerState.breakpoints) {
		if (lines.size === 0) {
			continue;
		}
		const sorted = new Array<number>(lines.size);
		let index = 0;
		for (const line of lines) {
			sorted[index] = line;
			index += 1;
		}
		sorted.sort((a, b) => a - b);
		payload[path] = sorted;
	}
	return payload;
}

export function restoreBreakpointsFromPayload(
	debuggerState: RuntimeDebuggerState,
	payload: SerializedBreakpointMap,
): void {
	debuggerState.breakpoints.clear();
	for (const path in payload) {
		const lineEntries = payload[path];
		if (lineEntries.length === 0) {
			continue;
		}
		debuggerState.breakpoints.set(path, new Set(lineEntries));
	}
}
