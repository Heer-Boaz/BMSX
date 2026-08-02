import {
	rebuildRuntimeBreakpointPcs,
	RuntimeDebuggerStopReason,
	type RuntimeBreakpointState,
	type RuntimeDebuggerState,
} from '../../../runtime/debugger_state';
import { showEditorMessage } from '../../../common/feedback_state';
import type { CartEditor } from '../../../cart_editor';
import { getActiveCodeTabContext } from '../../ui/code_tab/contexts';
import * as constants from '../../../common/constants';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import {
	blua32SourceRangeAtPc,
} from '../../../../toolchain/ts/rompack/blua32_symbols';
import { blua32ToolingImageForDomain } from '../../../../toolchain/ts/rompack/blua32_media';
import { resolveRuntimeLuaSource } from '../../../runtime/sources';
import { focusExecutionStop } from '../../../runtime_error/navigation';

export class BreakpointController {
	public revision = 0;

	public constructor(private readonly state: RuntimeDebuggerState) {}

	public toggleBreakpointForEditorRow(row: number = editorDocumentState.cursorRow): boolean {
		const context = getActiveCodeTabContext();
		if (context.mode !== 'lua') {
			return false;
		}
		if (row < 0 || row >= editorDocumentState.buffer.getLineCount()) {
			return false;
		}
		const resource = context.resource;
		if (!resource.path) {
			showEditorMessage('No active path available for breakpoints.', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const lineNumber = row + 1;
		const result = toggleBreakpoint(this.state, resource, lineNumber);
		if (result === 'unchanged') {
			return false;
		}
		this.revision += 1;
		const verb = result === 'added' ? 'set' : 'cleared';
		showEditorMessage(`Breakpoint ${verb} at ${resource.path}:${lineNumber}`, constants.COLOR_STATUS_TEXT, 1.4);
		return true;
	}
}

type SerializedBreakpoint = {
	domain: ResourceDomain;
	path: string;
	lines: number[];
};

export type SerializedBreakpoints = SerializedBreakpoint[];

export type BreakpointToggleResult = 'added' | 'removed' | 'unchanged';
const EMPTY_BREAKPOINTS: ReadonlySet<number> = new Set<number>();

function ensureBucket(debuggerState: RuntimeBreakpointState, resource: ResourceIdentity): Set<number> {
	const breakpoints = debuggerState.breakpoints[resource.domain + 1];
	let bucket = breakpoints.get(resource.path);
	if (!bucket) {
		bucket = new Set<number>();
		breakpoints.set(resource.path, bucket);
	}
	return bucket;
}

export function getBreakpointsForChunk(
	debuggerState: RuntimeBreakpointState,
	resource: ResourceIdentity,
): ReadonlySet<number> {
	if (!resource.path) {
		return EMPTY_BREAKPOINTS;
	}
	const bucket = debuggerState.breakpoints[resource.domain + 1].get(resource.path);
	return bucket || EMPTY_BREAKPOINTS;
}

export function toggleBreakpoint(
	debuggerState: RuntimeDebuggerState,
	resource: ResourceIdentity,
	line: number,
): BreakpointToggleResult {
	if (line < 1) {
		return 'unchanged';
	}
	const breakpoints = debuggerState.breakpoints[resource.domain + 1];
	const bucket = ensureBucket(debuggerState, resource);
	if (bucket.has(line)) {
		bucket.delete(line);
		if (bucket.size === 0) {
			breakpoints.delete(resource.path);
		}
		rebuildRuntimeBreakpointPcs(debuggerState);
		return 'removed';
	}
	bucket.add(line);
	rebuildRuntimeBreakpointPcs(debuggerState);
	return 'added';
}

export function serializeBreakpoints(debuggerState: RuntimeBreakpointState): SerializedBreakpoints {
	const payload: SerializedBreakpoints = [];
	for (let domainIndex = 0; domainIndex < debuggerState.breakpoints.length; domainIndex += 1) {
		for (const [path, lines] of debuggerState.breakpoints[domainIndex]) {
			const sorted = new Array<number>(lines.size);
			let lineIndex = 0;
			for (const line of lines) {
				sorted[lineIndex] = line;
				lineIndex += 1;
			}
			sorted.sort((a, b) => a - b);
			payload.push({
				domain: (domainIndex - 1) as ResourceDomain,
				path,
				lines: sorted,
			});
		}
	}
	payload.sort((left, right) => left.domain - right.domain
		|| (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	return payload;
}

export function restoreBreakpointsFromPayload(
	debuggerState: RuntimeBreakpointState,
	payload: SerializedBreakpoints,
): void {
	for (let domainIndex = 0; domainIndex < debuggerState.breakpoints.length; domainIndex += 1) {
		debuggerState.breakpoints[domainIndex].clear();
	}
	for (const breakpoint of payload) {
		debuggerState.breakpoints[breakpoint.domain + 1].set(
			breakpoint.path,
			new Set(breakpoint.lines),
		);
	}
}

export function presentRuntimeDebuggerStop(
	editor: CartEditor,
	state: RuntimeDebuggerState,
): void {
	state.stopPresentationPending = false;
	const image = blua32ToolingImageForDomain(
		state.sources.currentBlua32Media,
		state.stopDomain,
	)!;
	const range = blua32SourceRangeAtPc(
		image.symbols!,
		image.layout.header.textAddress,
		state.stopPc,
	)!;
	const source = resolveRuntimeLuaSource(state.sources, {
		domain: state.stopDomain,
		path: range.path,
	})!;
	focusExecutionStop(editor, {
		domain: source.domain,
		path: source.record.source_path,
	}, range.start.line, range.start.column);
	showEditorMessage(
		state.stopReason === RuntimeDebuggerStopReason.Breakpoint
			? 'Paused on breakpoint'
			: 'Paused after step',
		constants.COLOR_STATUS_TEXT,
		1.4,
	);
}
