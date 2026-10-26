import { clamp } from '../../../../../machine/ts/common/clamp';
import { editorViewState } from '../../../../editor/ui/view/state';
import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import { pointerCapture, type PointerCaptureTarget } from '../../../../input/pointer/capture';
import { PointerButton } from '../../../../../hosts/common/input/pointer_event';
import type { EditorDiagnostic, PointerSnapshot } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../../machine/ts/common/scratchbuffer';
import * as constants from '../../../../common/constants';
import type { DiagnosticsCoverage } from '../../../services/diagnostics/resource_diagnostics';
import { resetInlineBlink } from '../../../../editor/render/caret';
import {
	clampProblemsPanelScrollIndex,
	computeProblemsPanelVisibleHeight,
	findProblemsPanelPreferredSelection,
	createProblemsPanelItemLayout,
	createProblemsPanelLayout,
	writeProblemsPanelItemLayout,
	writeProblemsPanelLayout,
	type ProblemsPanelItemLayout,
	type PanelLayout,
	getProblemsPanelBounds,
	clampProblemsPanelHeight,
} from './layout';
import { drawProblemsPanelSurface } from './render';
import { handleProblemsPanelKeyboardInput } from './keyboard';
import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { handleProblemsPanelNavigationCommand, type ProblemsPanelCommand } from './navigation';
import { handleProblemsPanelPointerInput } from './pointer';
import type { EditorGroupView } from '../../../services/editor/editor_group';
import { inputFocus } from '../../../../input/focus';
import { ProblemsPanelHeader } from './header';
import type { EditorCommandRunner } from '../../../../common/commands';
import { measureText, measureTextRange } from '../../../../editor/common/text/layout';
import type { WorkbenchSurface } from '../../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../../services/windows/service';
import { WorkbenchTooltip } from '../../../ui/tooltip';

export {
	getProblemsPanelBounds,
	isPointerOverProblemsPanelDivider,
} from './layout';

const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];

export class ProblemsPanelController implements PointerHoverTarget, PointerCaptureTarget {
	public onPointerLeave(): void { this.hoverIndex = -1; this.header.onPointerLeave(); this.feedback.hide(); }
	private visible = false;
	public readonly focusTarget = inputFocus.createTarget();
	public readonly header = new ProblemsPanelHeader(this.focusTarget);
	private diagnostics: readonly EditorDiagnostic[] = EMPTY_DIAGNOSTICS;
	/** Marker identity survives pending coverage; version belongs only to fresh published rows. */
	private selectionIntent: Omit<EditorDiagnostic, 'version'> | undefined;
	private selectionIndex = -1;
	private hoverIndex = -1;
	/** Requested diagnostic-row position; pending projection cannot erase the reading intent. */
	private scrollPosition = 0;
	private readonly layout = createProblemsPanelLayout();
	private readonly itemLayouts = new ScratchBuffer<ProblemsPanelItemLayout>(createProblemsPanelItemLayout);
	private cachedLayout: PanelLayout = null;
	private fixedHeightPx: number = null;
	private resizeStartY = 0;
	private resizeStartHeight = 0;
	private resizeLastY = 0;
	private lastAvailableWidth = 1;
	private readonly feedback = new WorkbenchTooltip();
	private feedbackArea: Readonly<RectBounds> | undefined;
	private unbindFeedbackBlur: (() => void) | undefined;
	public emptyMessage = 'No resources checked.';

	public constructor() {
		this.focusTarget.clipboard = { readOnly: true, copy: () => this.selectionIndex < 0 ? null : this.getItemLayout(this.selectionIndex).feedback };
	}

	public attach(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>, commands: EditorCommandRunner): void {
		this.header.attach(surfaces, owner, workArea, commands);
		this.feedback.attach(surfaces, owner, workArea); this.feedbackArea = workArea;
		this.unbindFeedbackBlur = this.focusTarget.onDidBlur(() => this.feedback.hide());
	}

	public detach(): void {
		pointerCapture.cancelTarget(this);
		this.feedback.detach(); this.feedbackArea = undefined;
		this.unbindFeedbackBlur?.(); this.unbindFeedbackBlur = undefined;
		this.header.detach();
	}

	public get isVisible(): boolean {
		return this.visible;
	}

	public get isFocused(): boolean {
		return this.focusTarget.hasFocus || this.header.hasFocus;
	}

	public get selectedDiagnostic(): EditorDiagnostic {
		if (this.selectionIndex < 0 || this.selectionIndex >= this.diagnostics.length) return null;
		return this.diagnostics[this.selectionIndex];
	}

	public getDiagnostics(): readonly EditorDiagnostic[] {
		return this.diagnostics;
	}

	public get visibleHeight(): number {
		if (!this.visible) return 0;
		if (this.fixedHeightPx !== null) return computeProblemsPanelVisibleHeight(0, this.fixedHeightPx);
		const width = editorViewState.viewportWidth - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2;
		const limit = constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS * editorViewState.lineHeight;
		let contentHeight = 0;
		for (let index = 0; index < this.diagnostics.length && contentHeight < limit; index++) contentHeight += this.getItemLayout(index, width).height;
		return computeProblemsPanelVisibleHeight(contentHeight, this.fixedHeightPx);
	}

	public show(): void {
		if (this.visible) return;
		this.visible = true;
		this.header.setVisible(true);
		this.scrollPosition = 0; // open at top
		this.hoverIndex = -1;
		this.selectionIndex = -1; // no implicit selection on open
		this.selectionIntent = undefined;
		this.cachedLayout = null;
	}

	public hide(): void {
		pointerCapture.cancelTarget(this);
		pointerHover.release(this);
		if (!this.visible) {
			return;
		}
		this.visible = false;
		this.feedback.hide();
		this.header.setVisible(false);
		this.focusTarget.release();
		this.hoverIndex = -1;
		this.cachedLayout = null;
	}

	public setFocused(focused: boolean): void {
		if (focused) this.focusTarget.focus();
		else this.focusTarget.release();
	}

	public setHoverIndex(index: number): void {
		this.hoverIndex = index;
		if (index < 0) this.feedback.hide();
	}

	public setSelectionIndex(index: number): void {
		this.selectionIndex = index;
		this.selectionIntent = this.diagnostics[index];
	}

	public getSelectionIndex(): number {
		return this.selectionIndex;
	}

	public getHoverIndex(): number {
		return this.hoverIndex;
	}

	public getScrollIndex(): number {
		return clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length) | 0;
	}


	public getCachedLayout(): PanelLayout {
		return this.cachedLayout;
	}

	public resolveAvailableWidth(bounds: RectBounds): number {
		return bounds.right - bounds.left - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2;
	}

	public prepareLayout(bounds: RectBounds): PanelLayout {
		this.cachedLayout = writeProblemsPanelLayout(bounds, this.layout);
		this.lastAvailableWidth = this.resolveAvailableWidth(bounds);
		this.header.layout(editorViewState.font.renderFont(), bounds.left, this.layout.headerTop, bounds.right, this.layout.headerBottom);
		return this.layout;
	}

	public getItemLayout(index: number, availableWidth = this.lastAvailableWidth): ProblemsPanelItemLayout {
		const itemLayout = this.itemLayouts.get(index);
		return writeProblemsPanelItemLayout(itemLayout, this.diagnostics[index], this.resolvePanelWidth(availableWidth));
	}

	public setDiagnostics(diagnostics: readonly EditorDiagnostic[], coverage: DiagnosticsCoverage): void {
		this.feedback.hide();
		this.diagnostics = diagnostics;
		this.header.setCoverage(diagnostics.length, coverage);
		this.emptyMessage = coverage.failed > 0 ? 'Diagnostic computation failed.'
			: coverage.pending > 0 ? 'Diagnostics pending.'
				: coverage.ready === 0 ? 'No resources checked.'
					: 'No problems in checked resources. Unopened files are not checked.';
		this.itemLayouts.clear();
		this.ensureSelectionValidity(coverage.pending > 0);
		this.hoverIndex = -1;
		this.cachedLayout = null;
	}

	public draw(bounds: RectBounds): void {
		if (!this.visible) {
			this.cachedLayout = null;
			return;
		}
		const layout = this.prepareLayout(bounds);
		drawProblemsPanelSurface(
			this,
			bounds,
			layout,
		);
	}

	public update(): void {
		const bounds = getProblemsPanelBounds();
		if (bounds === null) { pointerCapture.cancelTarget(this); return; }
		this.prepareLayout(bounds);
		this.header.updateFeedback();
		this.updateFeedback(bounds);
	}

	/** The row is compact; its passive disclosure retains the qualified resource and whole message. */
	public updateFeedback(bounds: RectBounds): void {
		if (!this.visible || this.feedbackArea === undefined) return;
		if (this.header.hasFocus || this.header.actions.hoveredCommand !== null) { this.feedback.hide(); return; }
		const index = this.hoverIndex >= 0 ? this.hoverIndex : this.focusTarget.hasFocus ? this.selectionIndex : -1;
		if (index < this.getScrollIndex()) { this.feedback.hide(); return; }
		const layout = this.cachedLayout;
		let top = layout.contentTop;
		for (let row = this.getScrollIndex(); row < index; row++) top += this.getItemLayout(row).height;
		if (top >= layout.contentBottom) { this.feedback.hide(); return; }
		const item = this.getItemLayout(index);
		// Disclose outside the part, not over a neighboring diagnostic card.
		this.feedback.show(item.feedback, bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.feedbackArea);
	}

	public handlePointer(
		editorGroup: EditorGroupView,
		snapshot: PointerSnapshot,
		justPressed: boolean,
		_justReleased: boolean,
		bounds: RectBounds,
	): boolean {
		return handleProblemsPanelPointerInput(this, editorGroup, snapshot, justPressed, bounds);
	}

	public handlePointerWheel(deltaRows: number, bounds: RectBounds): boolean {
		if (!this.visible || this.diagnostics.length === 0) return false;
		this.prepareLayout(bounds);
		const projectedPosition = clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length);
		let index = projectedPosition | 0;
		let offset = (projectedPosition - index) * this.getItemLayout(index).height + deltaRows * editorViewState.lineHeight;
		while (offset < 0 && index > 0) {
			index -= 1;
			offset += this.getItemLayout(index).height;
		}
		while (index < this.diagnostics.length - 1 && offset >= this.getItemLayout(index).height) {
			offset -= this.getItemLayout(index).height;
			index += 1;
		}
		const position = clamp(index + offset / this.getItemLayout(index).height, 0, this.diagnostics.length - 1);
		if (position === this.scrollPosition) return false;
		this.scrollPosition = position;
		this.hoverIndex = -1;
		return true;
	}

	public handleKeyboard(playerInput: KeyInputEvent, editorGroup: EditorGroupView): void {
		handleProblemsPanelKeyboardInput(playerInput, this, editorGroup);
	}

	public handleKeyboardCommand(
		editorGroup: EditorGroupView,
		command: ProblemsPanelCommand,
	): boolean {
		return handleProblemsPanelNavigationCommand(this, editorGroup, command);
	}

	public setFixedHeightPx(height: number): void { this.fixedHeightPx = height > 0 ? height : null; this.cachedLayout = null; }

	public beginResize(snapshot: PointerSnapshot, presentedHeight: number): void {
		this.resizeStartY = this.resizeLastY = snapshot.viewportY;
		this.resizeStartHeight = presentedHeight;
		pointerCapture.capture(this);
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		if (snapshot.viewportY === this.resizeLastY) return;
		this.resizeLastY = snapshot.viewportY;
		this.setFixedHeightPx(clampProblemsPanelHeight(this.resizeStartHeight + this.resizeStartY - snapshot.viewportY));
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		pointerCapture.release(this);
		this.handleCapturedPointer(snapshot);
	}

	public cancelPointer(): void { pointerCapture.release(this); }

	public resolvePanelWidth(width = this.lastAvailableWidth): number { return width; }

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

export const problemsPanel = new ProblemsPanelController();

export function drawProblemsPanel() {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return null;
	}
	problemsPanel.draw(bounds);
	return bounds;
}
export function toggleProblemsPanel(editorGroup: EditorGroupView): void {
	if (problemsPanel.isVisible) {
		hideProblemsPanel(editorGroup);
		return;
	}
	showProblemsPanel();
}

export function showProblemsPanel(): void {
	problemsPanel.show();
}

export function hideProblemsPanel(editorGroup: EditorGroupView): void {
	const restoreEditorFocus = problemsPanel.isFocused;
	problemsPanel.hide();
	if (restoreEditorFocus) editorGroup.panes.activePane?.focus();
	resetInlineBlink();
}
