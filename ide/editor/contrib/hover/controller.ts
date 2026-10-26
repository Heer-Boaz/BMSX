import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { editorTextModelService } from '../../model/model_service';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import * as constants from '../../../common/constants';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaHover } from '../../../../toolchain/ts/lua/semantic/hover';
import type { CodeEditorControl } from '../../ui/code_editor_control';
import type { EditorTextModel } from '../../model/text_model';
import type { EditorFont } from '../../ui/view/font';
import type { Blua32SourceMedia } from '../../../runtime/sources';
import { writeWrappedMeasuredLine } from '../../../common/text';
import {
	buildEditorSemanticSnapshot,
	createEditorSemanticFrontend,
} from '../intellisense/frontend';
import { getOrCreateSemanticProject } from '../intellisense/semantic/workspace/state';
import {
	inspectLuaRuntimeExpression,
	type LuaRuntimeInspection,
} from '../intellisense/engine';

type HoverQueryState = {
	valid: boolean;
	model: EditorTextModel | null;
	font: EditorFont | undefined;
	row: number;
	column: number;
	textVersion: number;
	wrapWidth: number;
	evaluatesRuntime: boolean;
	executionPc: number;
	executionFrameDepth: number;
	executionCycles: number;
	media: Blua32SourceMedia | undefined;
	faultSnapshot: RuntimeFaultState['faultSnapshot'];
	semanticSnapshot: LuaSemanticWorkspaceSnapshot;
};

export class CodeEditorHoverController {
	private readonly queryState: HoverQueryState = {
		valid: false, model: null, font: undefined,
		row: 0,
		column: 0,
		textVersion: 0,
		wrapWidth: 0,
		evaluatesRuntime: false,
		executionPc: 0,
		executionFrameDepth: 0,
		executionCycles: 0,
		media: undefined,
		faultSnapshot: null,
		semanticSnapshot: null,
	};

	public constructor(private readonly code: CodeEditorControl, private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession, private readonly fault: RuntimeFaultState, private readonly runtime: Runtime) {}

	public update(row: number, column: number): void {
		if (this.code.model.mode !== 'lua') {
			this.clear();
			return;
		}
		const path = this.code.model.resource.path;
		const textVersion = this.code.model.version;
		const wrapWidth = Math.max(
			this.code.spaceAdvance,
			this.code.geometry.clientBounds.right - this.code.geometry.clientBounds.left
				- constants.HOVER_TOOLTIP_PADDING_X * 2
				- this.code.spaceAdvance * 2,
		);
		const cpu = this.runtime.machine.cpu;
		const executionCycles = this.runtime.machine.scheduler.currentNowCycles();
		const media = this.sources.currentBlua32Media;
		const executionPc = this.fault.faultSnapshot === null ? cpu.lastPc : this.fault.lastCpuFaultPc;
		const executionFrameDepth = this.fault.faultSnapshot === null
			? cpu.getFrameDepth()
			: this.fault.lastCpuFaultSnapshot.length;
		const semanticProject = getOrCreateSemanticProject(editorTextModelService, this.code.model.resource.domain);
		semanticProject.synchronizeRuntimeSources(this.sources);
		const semanticSnapshot = semanticProject.getSnapshot();
		if (this.queryState.valid
			&& this.queryState.model === this.code.model
			&& this.queryState.font === this.code.font
			&& this.queryState.row === row
			&& this.queryState.column === column
			&& this.queryState.textVersion === textVersion
			&& this.queryState.wrapWidth === wrapWidth
			&& this.queryState.semanticSnapshot === semanticSnapshot
			&& (!this.queryState.evaluatesRuntime
				|| (this.queryState.executionPc === executionPc
					&& this.queryState.executionFrameDepth === executionFrameDepth
					&& this.queryState.executionCycles === executionCycles
					&& this.queryState.media === media
					&& this.queryState.faultSnapshot === this.fault.faultSnapshot))) {
			return;
		}

		const snapshot = buildEditorSemanticSnapshot(
			this.sources,
			this.code.model.resource,
			this.code.model.buffer,
		);
		const frontend = createEditorSemanticFrontend(snapshot, this.code.model.resource.domain);
		const semanticHover = frontend.provideHover(path, row + 1, column + 1);
		const evaluatableExpression = frontend.provideEvaluatableExpression(path, row + 1, column + 1);
		const runtimeInspection = evaluatableExpression === null
			? null
			: inspectLuaRuntimeExpression(
				this.sources,
				this.guest,
				this.fault,
				this.runtime,
				evaluatableExpression.expression,
				this.code.model.resource.domain,
				snapshot.getFileData(path)!,
				evaluatableExpression.range.start.line,
				evaluatableExpression.range.start.column,
			);

		this.queryState.valid = true;
		this.queryState.model = this.code.model; this.queryState.font = this.code.font;
		this.queryState.row = row;
		this.queryState.column = column;
		this.queryState.textVersion = textVersion;
		this.queryState.wrapWidth = wrapWidth;
		this.queryState.evaluatesRuntime = evaluatableExpression !== null;
		this.queryState.executionPc = executionPc;
		this.queryState.executionFrameDepth = executionFrameDepth;
		this.queryState.executionCycles = executionCycles;
		this.queryState.media = media;
		this.queryState.faultSnapshot = this.fault.faultSnapshot;
		this.queryState.semanticSnapshot = snapshot;

		let range;
		if (semanticHover === null) {
			if (evaluatableExpression === null || runtimeInspection === null) {
				this.code.hoverTooltip = null;
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
			writeWrappedMeasuredLine(wrappedLines, lines[index], wrapWidth, this.code.font.measureTextRange);
		}
		const lineWidths = wrappedLines.map(line => this.code.font.measure(line));
		this.code.hoverTooltip = {
			contentLines: wrappedLines, lineWidths,
			path,
			row: range.start.line - 1,
			startColumn: range.start.column - 1,
			endColumn: range.end.column,
			scrollOffset: 0,
			visibleLineCount: 0,
			bubbleBounds: create_rect_bounds(),
		};
	}

	public clear(): void {
		this.code.hoverTooltip = null;
		this.queryState.valid = false; this.queryState.model = null; this.queryState.font = undefined;
		this.queryState.media = undefined; this.queryState.faultSnapshot = null; this.queryState.semanticSnapshot = null;
	}
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
	if (inspection.state === 'unavailable') {
		lines.push(`${inspection.expression}: ${inspection.lines[0]}`);
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
