import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import * as constants from '../../../common/constants';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaHover } from '../../../../toolchain/ts/lua/semantic/hover';
import type { EditorDocumentContext } from '../../editing/document_state';
import { editorDocumentState } from '../../editing/document_state';
import { writeWrappedOverlayLine } from '../../common/text/layout';
import { editorViewState } from '../../ui/view/state';
import {
	buildEditorSemanticSnapshot,
	createEditorSemanticFrontend,
} from '../intellisense/frontend';
import { getOrCreateSemanticProject } from '../intellisense/semantic/workspace/state';
import {
	inspectLuaRuntimeExpression,
	type LuaRuntimeInspection,
} from '../intellisense/engine';
import { hoverState } from './state';

type HoverQueryState = {
	valid: boolean;
	path: string;
	row: number;
	column: number;
	textVersion: number;
	wrapWidth: number;
	evaluatesRuntime: boolean;
	executionPc: number;
	executionFrameDepth: number;
	faultSequence: number;
	semanticSnapshot: LuaSemanticWorkspaceSnapshot;
};

const queryState: HoverQueryState = {
	valid: false,
	path: '',
	row: 0,
	column: 0,
	textVersion: 0,
	wrapWidth: 0,
	evaluatesRuntime: false,
	executionPc: 0,
	executionFrameDepth: 0,
	faultSequence: 0,
	semanticSnapshot: null,
};

export function updateHoverTooltip(
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	context: EditorDocumentContext,
	row: number,
	column: number,
): void {
	if (context.mode !== 'lua') {
		clearHoverTooltip();
		return;
	}
	const path = context.resource.path;
	const textVersion = editorDocumentState.buffer.version;
	const wrapWidth = Math.max(
		editorViewState.spaceAdvance,
		editorViewState.viewportWidth
			- constants.HOVER_TOOLTIP_PADDING_X * 2
			- editorViewState.spaceAdvance * 2,
	);
	const cpu = runtime.machine.cpu;
	const executionPc = fault.faultSnapshot === null ? cpu.lastPc : fault.lastCpuFaultPc;
	const executionFrameDepth = fault.faultSnapshot === null
		? cpu.getFrameDepth()
		: fault.lastCpuFaultSnapshot.length;
	const semanticProject = getOrCreateSemanticProject(context.resource.domain);
	semanticProject.synchronizeRuntimeSources(bridge.sources);
	const semanticSnapshot = semanticProject.getSnapshot();
	if (queryState.valid
		&& queryState.path === path
		&& queryState.row === row
		&& queryState.column === column
		&& queryState.textVersion === textVersion
		&& queryState.wrapWidth === wrapWidth
		&& queryState.semanticSnapshot === semanticSnapshot
		&& (!queryState.evaluatesRuntime
			|| (queryState.executionPc === executionPc
				&& queryState.executionFrameDepth === executionFrameDepth
				&& queryState.faultSequence === fault.supervisorFaultSequence))) {
		return;
	}

	const snapshot = buildEditorSemanticSnapshot(
		bridge,
		context.resource,
		editorDocumentState.buffer,
	);
	const frontend = createEditorSemanticFrontend(bridge, snapshot);
	const semanticHover = frontend.provideHover(path, row + 1, column + 1);
	const evaluatableExpression = frontend.provideEvaluatableExpression(path, row + 1, column + 1);
	const runtimeInspection = evaluatableExpression === null
		? null
		: inspectLuaRuntimeExpression(
			bridge,
			fault,
			runtime,
			evaluatableExpression.expression,
			context.resource.domain,
			path,
			evaluatableExpression.range.start.line,
			evaluatableExpression.range.start.column,
		);

	queryState.valid = true;
	queryState.path = path;
	queryState.row = row;
	queryState.column = column;
	queryState.textVersion = textVersion;
	queryState.wrapWidth = wrapWidth;
	queryState.evaluatesRuntime = evaluatableExpression !== null;
	queryState.executionPc = executionPc;
	queryState.executionFrameDepth = executionFrameDepth;
	queryState.faultSequence = fault.supervisorFaultSequence;
	queryState.semanticSnapshot = snapshot;

	let range;
	if (semanticHover === null) {
		if (evaluatableExpression === null || runtimeInspection === null) {
			hoverState.tooltip = null;
			return;
		}
		range = evaluatableExpression.range;
	} else {
		range = semanticHover.applicableRange;
	}
	const lines: string[] = [];
	if (semanticHover !== null) {
		appendSemanticHover(lines, semanticHover);
	}
	if (runtimeInspection !== null) {
		if (lines.length > 0) {
			lines.push('');
		}
		appendRuntimeInspection(lines, runtimeInspection);
	}
	const wrappedLines: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		writeWrappedOverlayLine(wrappedLines, lines[index], wrapWidth);
	}
	hoverState.tooltip = {
		contentLines: wrappedLines,
		path,
		row: range.start.line - 1,
		startColumn: range.start.column - 1,
		endColumn: range.end.column,
		scrollOffset: 0,
		visibleLineCount: 0,
		bubbleBounds: null,
	};
}

export function clearHoverTooltip(): void {
	hoverState.tooltip = null;
	queryState.valid = false;
}

function appendSemanticHover(lines: string[], hover: LuaHover): void {
	for (let index = 0; index < hover.contents.length; index += 1) {
		if (index > 0) {
			lines.push('');
		}
		const content = hover.contents[index];
		lines.push(content.label);
		if (content.documentation !== undefined) {
			appendTextLines(lines, content.documentation);
		}
	}
}

function appendTextLines(lines: string[], text: string): void {
	let start = 0;
	let end = text.indexOf('\n');
	while (end >= 0) {
		lines.push(text.slice(start, end));
		start = end + 1;
		end = text.indexOf('\n', start);
	}
	lines.push(text.slice(start));
}

function appendRuntimeInspection(lines: string[], inspection: LuaRuntimeInspection): void {
	if (inspection.state === 'not_defined') {
		lines.push(`${inspection.expression} = not defined`);
		return;
	}
	const suffix = inspection.valueType === 'unknown' ? '' : ` (${inspection.valueType})`;
	if (inspection.lines.length === 1) {
		lines.push(`${inspection.expression} = ${inspection.lines[0]}${suffix}`);
		return;
	}
	lines.push(`${inspection.expression}${suffix}`);
	for (let index = 0; index < inspection.lines.length; index += 1) {
		lines.push(`  ${inspection.lines[index]}`);
	}
}
