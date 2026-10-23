import { clamp } from '../../../../../machine/ts/common/clamp';
import { editorViewState } from '../../../../editor/ui/view/state';
import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import type { EditorDiagnostic, PointerSnapshot } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../../machine/ts/common/scratchbuffer';
import * as constants from '../../../../common/constants';
import type { DiagnosticsCoverage } from '../../../services/diagnostics/resource_diagnostics';
import { resetBlink } from '../../../../editor/render/caret';
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
} from './layout';
import { drawProblemsPanelSurface } from './render';
import { handleProblemsPanelKeyboardInput } from './keyboard';
import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { handleProblemsPanelNavigationCommand, type ProblemsPanelCommand } from './navigation';
import { handleProblemsPanelPointerInput } from './pointer';
import type { EditorPanes } from '../../../services/editor/editor_panes';
import { inputFocus } from '../../../../input/focus';
import { ProblemsPanelHeader } from './header';

export {
	getProblemsPanelBounds,
	isPointerOverProblemsPanelDivider,
	setProblemsPanelHeightFromViewportY,
} from './layout';

const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];

export class ProblemsPanelController implements PointerHoverTarget {
	public onPointerLeave(): void { this.hoverIndex = -1; this.header.onPointerLeave(); }
	private visible = false;
	public readonly focusTarget = inputFocus.createTarget();
	public readonly header = new ProblemsPanelHeader(this.focusTarget);
	private diagnostics: readonly EditorDiagnostic[] = EMPTY_DIAGNOSTICS;
	private selectionIndex = -1;
	private hoverIndex = -1;
	/** Continuous diagnostic-row position; item lookup uses getScrollIndex(). */
	private scrollPosition = 0;
	private readonly layout = createProblemsPanelLayout();
	private readonly itemLayouts = new ScratchBuffer<ProblemsPanelItemLayout>(createProblemsPanelItemLayout);
	private cachedLayout: PanelLayout = null;
	private fixedHeightPx: number = null;
	private lastAvailableWidth = 1;
	public emptyMessage = 'No resources checked.';

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
		return computeProblemsPanelVisibleHeight(this.diagnostics.length, this.fixedHeightPx);
	}

	public show(): void {
		if (this.visible) return;
		this.visible = true;
		this.header.setVisible(true);
		this.scrollPosition = 0; // open at top
		this.hoverIndex = -1;
		this.selectionIndex = -1; // no implicit selection on open
		this.cachedLayout = null;
	}

	public hide(): void {
		pointerHover.release(this);
		if (!this.visible) {
			return;
		}
		this.visible = false;
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
	}

	public setSelectionIndex(index: number): void {
		this.selectionIndex = index;
	}

	public getSelectionIndex(): number {
		return this.selectionIndex;
	}

	public getHoverIndex(): number {
		return this.hoverIndex;
	}

	public getScrollIndex(): number {
		return this.scrollPosition | 0;
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
		this.diagnostics = diagnostics;
		this.header.setCoverage(diagnostics.length, coverage);
		this.emptyMessage = coverage.failed > 0 ? 'Diagnostic computation failed.'
			: coverage.pending > 0 ? 'Diagnostics pending.'
				: coverage.ready === 0 ? 'No resources checked.'
					: 'No problems in checked resources. Unopened files are not checked.';
		this.itemLayouts.clear();
		this.ensureSelectionValidity();
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
		if (bounds === null) return;
		this.prepareLayout(bounds);
		this.header.updateFeedback();
	}

	public handlePointer(
		editorPanes: EditorPanes,
		snapshot: PointerSnapshot,
		justPressed: boolean,
		_justReleased: boolean,
		bounds: RectBounds,
	): boolean {
		return handleProblemsPanelPointerInput(this, editorPanes, snapshot, justPressed, bounds);
	}

	public handlePointerWheel(deltaRows: number, bounds: RectBounds): boolean {
		if (!this.visible || this.diagnostics.length === 0) return false;
		this.prepareLayout(bounds);
		let index = this.getScrollIndex();
		let offset = (this.scrollPosition - index) * this.getItemLayout(index).height + deltaRows * editorViewState.lineHeight;
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

	public handleKeyboard(playerInput: KeyInputEvent, editorPanes: EditorPanes): void {
		handleProblemsPanelKeyboardInput(playerInput, this, editorPanes);
	}

	public handleKeyboardCommand(
		editorPanes: EditorPanes,
		command: ProblemsPanelCommand,
	): boolean {
		return handleProblemsPanelNavigationCommand(this, editorPanes, command);
	}

	public setFixedHeightPx(height: number): void { this.fixedHeightPx = height > 0 ? height : null; this.cachedLayout = null; }

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

	private ensureSelectionValidity(): void {
		this.selectionIndex = findProblemsPanelPreferredSelection(this.diagnostics, this.selectionIndex);
		this.scrollPosition = clampProblemsPanelScrollIndex(this.scrollPosition, this.diagnostics.length);
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
export function toggleProblemsPanel(editorPanes: EditorPanes): void {
	if (problemsPanel.isVisible) {
		hideProblemsPanel(editorPanes);
		return;
	}
	showProblemsPanel();
}

export function showProblemsPanel(): void {
	problemsPanel.show();
}

export function hideProblemsPanel(editorPanes: EditorPanes): void {
	const restoreEditorFocus = problemsPanel.isFocused;
	problemsPanel.hide();
	if (restoreEditorFocus) editorPanes.activePane?.focus();
	resetBlink();
}
