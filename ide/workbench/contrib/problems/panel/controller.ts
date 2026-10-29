import { clamp } from '../../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../../machine/ts/common/scratchbuffer';
import * as constants from '../../../../common/constants';
import type { EditorCommandRunner } from '../../../../common/commands';
import type { EditorDiagnostic, PointerInputSnapshot, WheelInputSnapshot } from '../../../../common/models';
import type { EditorSourceLocationRequest } from '../../../../editor/navigation/source_location';
import { getDiagnosticSourceLocation } from '../../code_editor/diagnostics/navigation';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { editorViewState } from '../../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../../editor/common/text/layout';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../../input/focus';
import { pointerCapture } from '../../../../input/pointer/capture';
import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import type { MainWorkspaceActivityClient, MainWorkspaceActivitySizeConstraints } from '../../../common/main_workspace_activity';
import { truncateMeasuredText } from '../../../../common/text';
import { api } from '../../../../runtime/overlay_api';
import type { DiagnosticsCoverage } from '../../../services/diagnostics/resource_diagnostics';
import type { EditorParts } from '../../../services/editor/editor_parts';
import type { WorkbenchSurface } from '../../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../../services/windows/service';
import { WorkbenchTooltip } from '../../../ui/tooltip';
import { clampProblemsPanelScrollIndex, createProblemsPanelItemLayout, createProblemsPanelLayout,
	findProblemsPanelPreferredSelection, problemsPanelHeaderHeight, writeProblemsPanelItemLayout, writeProblemsPanelLayout,
	type PanelLayout, type ProblemsPanelItemLayout } from './layout';
import { ProblemsPanelHeader } from './header';
import { handleProblemsPanelKeyboardInput } from './keyboard';
import { handleProblemsPanelNavigationCommand, type ProblemsPanelCommand } from './navigation';
import { handleProblemsPanelPointerInput } from './pointer';
import { drawProblemsPanelSurface } from './render';

const EMPTY_DIAGNOSTICS: readonly EditorDiagnostic[] = [];

/** Retained diagnostic reading, independently attached to Main's activity allocation. */
export class ProblemsPanelController implements MainWorkspaceActivityClient, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly commandTarget: InputFocusTarget;
	public readonly header: ProblemsPanelHeader;
	public readonly bounds = create_rect_bounds();
	public readonly layoutState = createProblemsPanelLayout();
	private attachedValue = false;
	private attachmentRevision = 0;
	private diagnostics: readonly EditorDiagnostic[] = EMPTY_DIAGNOSTICS;
	/** Marker identity survives pending coverage; version belongs only to fresh published rows. */
	private selectionIntent: Omit<EditorDiagnostic, 'version'> | undefined;
	private selectionIndex = -1;
	private selectionRevisionValue = 0;
	private hoverIndex = -1;
	/** Pending projection and native detachment cannot erase the reading intent. */
	private scrollPosition = 0;
	private readonly itemLayouts = new ScratchBuffer<ProblemsPanelItemLayout>(createProblemsPanelItemLayout);
	private font: EditorFont | undefined;
	private measuredFont: EditorFont | undefined;
	private measuredWidth = -1;
	private measuredContent = false;
	private minimumHeight = 0;
	private preferredHeight = 0;
	private readonly feedback = new WorkbenchTooltip();
	private readonly unbindKeyboard: () => void;
	private readonly unbindFeedbackBlur: () => void;
	public emptyText = '';
	private emptySource = '';
	public emptyMessage = 'No resources checked.';

	public constructor(private readonly parts: EditorParts, commands: EditorCommandRunner,
		surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>,
		public readonly scope: InputFocusScope, focusReturn: InputFocusTarget) {
		this.commandTarget = this.focusTarget = inputFocus.createTarget(focusReturn, scope);
		this.focusTarget.canFocus = () => this.attached && this.bounds.left < this.bounds.right && this.bounds.top < this.bounds.bottom;
		this.focusTarget.clipboard = { readOnly: true, copy: () => this.selectionIndex < 0 ? null : this.getItemLayout(this.selectionIndex).feedback };
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => handleProblemsPanelKeyboardInput(input, this, parts));
		this.header = new ProblemsPanelHeader(this.focusTarget, surfaces, owner, workArea, commands);
		this.feedback.attach(surfaces, owner, workArea);
		this.unbindFeedbackBlur = this.focusTarget.onDidBlur(() => this.feedback.hide());
	}
	public get attached(): boolean { return this.attachedValue; }
	public get isFocused(): boolean { return this.focusTarget.hasFocus || this.header.hasFocus; }
	public get selectedDiagnostic(): EditorDiagnostic | undefined { return this.diagnostics[this.selectionIndex]; }
	public get contentWidth(): number { return this.bounds.right - this.bounds.left - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2; }
	public getDiagnostics(): readonly EditorDiagnostic[] { return this.diagnostics; }
	public get selectionRevision(): number { return this.selectionRevisionValue; }
	public getSelectionIndex(): number { return this.selectionIndex; }
	public getHoverIndex(): number { return this.hoverIndex; }
	public getScrollIndex(): number { return clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length) | 0; }
	public setSelectionIndex(index: number): void {
		if (this.selectionIndex !== index) this.selectionRevisionValue++;
		this.selectionIndex = index; this.selectionIntent = this.diagnostics[index];
	}
	public setHoverIndex(index: number): void {
		this.hoverIndex = index;
		if (index >= 0) pointerHover.visit(this);
		else { pointerHover.release(this); this.feedback.hide(); }
	}
	public focus(): void { this.focusTarget.focus(); }
	public get canOpenSource(): boolean { return this.attached && this.selectedDiagnostic !== undefined; }
	public captureSourceLocation(): EditorSourceLocationRequest | undefined {
		const diagnostic = this.selectedDiagnostic;
		if (!this.attached || diagnostic === undefined) return;
		const revision = this.selectionRevision, generation = this.scope.contextGeneration;
		const isCurrent = () => this.attached && this.selectionRevision === revision
			&& this.scope.contextGeneration === generation && this.selectedDiagnostic === diagnostic;
		return { isCurrent, readLocation: () => isCurrent() ? getDiagnosticSourceLocation(diagnostic) : undefined };
	}

	public measure(font: EditorFont, width: number, target: MainWorkspaceActivitySizeConstraints): void {
		if (!this.measuredContent || this.measuredFont !== font || this.measuredWidth !== width) {
			this.measuredFont = font; this.measuredWidth = width; this.measuredContent = true;
			const headerHeight = problemsPanelHeaderHeight(font) + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2;
			const minimumContent = constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS * font.lineHeight;
			const maximumContent = constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS * font.lineHeight;
			let contentHeight = 0;
			for (let index = 0; index < this.diagnostics.length && contentHeight < maximumContent; index++)
				contentHeight += this.getItemLayout(index, width - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2, font).height;
			this.minimumHeight = headerHeight + minimumContent;
			this.preferredHeight = headerHeight + clamp(contentHeight, minimumContent, maximumContent);
		}
		target.minimumHeight = this.minimumHeight; target.preferredHeight = this.preferredHeight;
	}
	public attach(bounds: Readonly<RectBounds>): void {
		if (this.attached) { this.layout(bounds); return; }
		const revision = ++this.attachmentRevision;
		this.attachedValue = true;
		this.layout(bounds);
		if (revision !== this.attachmentRevision) return;
		this.header.attach();
	}
	public layout(bounds: Readonly<RectBounds>): void {
		const font = editorViewState.font;
		const geometryChanged = this.font !== font || this.bounds.left !== bounds.left || this.bounds.top !== bounds.top
			|| this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom;
		if (geometryChanged) {
			this.font = font; copy_rect_bounds(this.bounds, bounds);
			writeProblemsPanelLayout(bounds, font, this.layoutState);
			this.header.layout(font.renderFont(), bounds.left, this.layoutState.headerTop, bounds.right, this.layoutState.headerBottom);
		}
		if (geometryChanged || this.emptySource !== this.emptyMessage) {
			this.emptySource = this.emptyMessage;
			this.emptyText = truncateMeasuredText(this.emptyMessage, this.contentWidth, font.measureTextRange);
		}
	}
	public detach(): void {
		if (!this.attached) return;
		const revision = ++this.attachmentRevision;
		this.attachedValue = false; this.hoverIndex = -1;
		this.feedback.hide(); pointerHover.release(this);
		this.scope.retireContext();
		if (revision !== this.attachmentRevision) return;
		pointerCapture.cancelScope(this.scope.surfaceScope);
		if (revision !== this.attachmentRevision) return;
		this.header.detach();
		if (revision === this.attachmentRevision) this.focusTarget.release();
	}
	public dispose(): void {
		this.detach(); this.header.dispose(); this.feedback.detach(); this.unbindKeyboard(); this.unbindFeedbackBlur();
	}
	public onPointerLeave(): void { this.hoverIndex = -1; this.header.onPointerLeave(); this.feedback.hide(); }
	public getItemLayout(index: number, width = this.contentWidth, font = this.font!): ProblemsPanelItemLayout {
		return writeProblemsPanelItemLayout(this.itemLayouts.get(index), this.diagnostics[index], width, font);
	}
	public setDiagnostics(diagnostics: readonly EditorDiagnostic[], coverage: DiagnosticsCoverage): void {
		const selected = this.selectedDiagnostic;
		this.feedback.hide(); this.diagnostics = diagnostics;
		this.header.setCoverage(diagnostics.length, coverage);
		this.emptyMessage = coverage.failed > 0 ? 'Diagnostic computation failed.'
			: coverage.pending > 0 ? 'Diagnostics pending.'
				: coverage.ready === 0 ? 'No resources checked.' : 'No problems in checked resources. Unopened files are not checked.';
		this.itemLayouts.clear(); this.measuredContent = false;
		this.ensureSelectionValidity(coverage.pending > 0);
		if (this.selectedDiagnostic !== selected) this.selectionRevisionValue++;
		this.hoverIndex = -1;
	}
	public draw(): void {
		if (this.attached) drawProblemsPanelSurface(this, this.bounds, this.layoutState);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		if (this.selectionIndex < 0) return;
		api.blit_text_inline_with_font(this.getItemLayout(this.selectionIndex).location, bounds.left + 4, bounds.top + 2,
			0, color, this.font!.renderFont());
	}
	public update(): void {
		if (!this.attached) return;
		this.layout(this.bounds);
		this.header.layout(this.font!.renderFont(), this.bounds.left, this.layoutState.headerTop, this.bounds.right, this.layoutState.headerBottom);
		this.header.updateFeedback(); this.updateFeedback();
	}
	/** The compact row discloses its qualified resource and complete message outside its allocation. */
	public updateFeedback(): void {
		if (!this.attached) return;
		if (this.header.hasFocus || this.header.actions.hoveredCommand !== null) { this.feedback.hide(); return; }
		const index = this.hoverIndex >= 0 ? this.hoverIndex : this.focusTarget.hasFocus ? this.selectionIndex : -1;
		if (index < this.getScrollIndex()) { this.feedback.hide(); return; }
		const layout = this.layoutState;
		let top = layout.contentTop;
		for (let row = this.getScrollIndex(); row < index && top < layout.contentBottom; row++) top += this.getItemLayout(row).height;
		if (top >= layout.contentBottom) { this.feedback.hide(); return; }
		this.feedback.show(this.getItemLayout(index).feedback, this.bounds, this.font!.renderFont(), measureTextRange, measureText, this.workArea);
	}
	public handlePointer(snapshot: PointerInputSnapshot): void {
		if (this.attached) handleProblemsPanelPointerInput(this, this.parts, snapshot);
	}
	public handleWheel(event: WheelInputSnapshot): void {
		if (!this.attached || this.diagnostics.length === 0) return;
		const projectedPosition = clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length);
		let index = projectedPosition | 0;
		let offset = (projectedPosition - index) * this.getItemLayout(index).height + event.deltaY * this.font!.lineHeight;
		while (offset < 0 && index > 0) { index--; offset += this.getItemLayout(index).height; }
		while (index < this.diagnostics.length - 1 && offset >= this.getItemLayout(index).height) {
			offset -= this.getItemLayout(index).height; index++;
		}
		const position = clamp(index + offset / this.getItemLayout(index).height, 0, this.diagnostics.length - 1);
		if (position !== this.scrollPosition) { this.scrollPosition = position; this.hoverIndex = -1; }
	}
	public handleKeyboardCommand(command: ProblemsPanelCommand): boolean {
		return handleProblemsPanelNavigationCommand(this, this.parts, command);
	}
	public estimateVisibleCount(layout: PanelLayout, availableWidth: number): number {
		if (this.diagnostics.length === 0) {
			return 0;
		}
		const viewportHeight = layout.contentBottom - layout.contentTop;
		let usedHeight = 0;
		let count = 0;
		for (let index = this.getScrollIndex(); index < this.diagnostics.length; index += 1) {
			const itemHeight = this.getItemLayout(index, availableWidth).height;
			if (usedHeight + itemHeight > viewportHeight) {
				break;
			}
			usedHeight += itemHeight;
			count += 1;
		}
		return count > 0 ? count : 1;
	}

	public revealSelection(layout: PanelLayout, availableWidth: number): void {
		const selectionIndex = this.selectionIndex;
		if (selectionIndex === -1) {
			this.scrollPosition = clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length);
			return;
		}
		if (selectionIndex < this.getScrollIndex()) {
			this.scrollPosition = selectionIndex;
			return;
		}
		const viewportHeight = layout.contentBottom - layout.contentTop;
		let nextScrollIndex = this.getScrollIndex();
		let usedHeight = 0;
		for (let index = nextScrollIndex; index <= selectionIndex; index += 1) {
			const itemHeight = this.getItemLayout(index, availableWidth).height;
			if (index < selectionIndex) {
				usedHeight += itemHeight;
				continue;
			}
			while (usedHeight + itemHeight > viewportHeight && nextScrollIndex < selectionIndex) {
				usedHeight -= this.getItemLayout(nextScrollIndex, availableWidth).height;
				nextScrollIndex += 1;
			}
		}
		if (nextScrollIndex !== this.getScrollIndex()) this.scrollPosition = clampProblemsPanelScrollIndex(nextScrollIndex, this.diagnostics.length);
	}

	private ensureSelectionValidity(pending: boolean): void {
		const intent = this.selectionIntent;
		let index = -1;
		if (intent !== undefined) {
			for (let candidateIndex = 0; candidateIndex < this.diagnostics.length; candidateIndex++) {
				const candidate = this.diagnostics[candidateIndex];
				if (candidate.model === intent.model && candidate.row === intent.row && candidate.startColumn === intent.startColumn
					&& candidate.endColumn === intent.endColumn && candidate.message === intent.message && candidate.severity === intent.severity) {
					index = candidateIndex;
					break;
				}
			}
		}
		// Settled deletion uses the normal first-error policy; pending absence is not deletion.
		if (index < 0 && !pending) index = findProblemsPanelPreferredSelection(this.diagnostics, -1);
		this.selectionIndex = index;
		if (index >= 0 || !pending) this.selectionIntent = this.diagnostics[index];
		if (!pending) this.scrollPosition = clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length);
	}
}
