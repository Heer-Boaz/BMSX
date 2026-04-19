import type { EditorDiagnostic, PointerSnapshot } from '../../../../common/models';
import type { RectBounds } from '../../../../../rompack/format';
import { ScratchBuffer } from '../../../../../common/scratchbuffer';
import * as constants from '../../../../common/constants';
import { markAllDiagnosticsDirty } from '../../../../editor/contrib/diagnostics/analysis';
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
import { handleProblemsPanelNavigationCommand, type ProblemsPanelCommand } from './navigation';
import { handleProblemsPanelPointerInput, handleProblemsPanelWheelInput } from './pointer';

export {
	getProblemsPanelBounds,
	isPointerOverProblemsPanelDivider,
	setProblemsPanelHeightFromViewportY,
} from './layout';

const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];

export class ProblemsPanelController {
	private visible = false;
	private focused = false;
	private diagnostics: EditorDiagnostic[] = EMPTY_DIAGNOSTICS;
	private selectionIndex = -1;
	private hoverIndex = -1;
	private scrollIndex = 0;
	private readonly layout = createProblemsPanelLayout();
	private readonly itemLayouts = new ScratchBuffer<ProblemsPanelItemLayout>(createProblemsPanelItemLayout);
	private cachedLayout: PanelLayout = null;
	private fixedHeightPx: number = null;
	private lastAvailableWidth = 1;
	private headerLabel = 'PROBLEMS (0)';

	public get isVisible(): boolean {
		return this.visible;
	}

	public get isFocused(): boolean {
		return this.focused;
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
		this.focused = false; // do not steal caret focus
		this.scrollIndex = 0; // open at top
		this.hoverIndex = -1;
		this.selectionIndex = -1; // no implicit selection on open
		this.cachedLayout = null;
	}

	public hide(): void {
		if (!this.visible) {
			return;
		}
		this.visible = false;
		this.focused = false;
		this.hoverIndex = -1;
		this.cachedLayout = null;
	}

	public setFocused(focused: boolean): void {
		this.focused = focused;
		if (!focused) {
			this.hoverIndex = -1;
		}
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
		return this.scrollIndex;
	}

	public setScrollIndex(index: number): void {
		this.scrollIndex = index;
	}

	public getCachedLayout(): PanelLayout {
		return this.cachedLayout;
	}

	public getHeaderLabel(): string {
		return this.headerLabel;
	}

	public resolveAvailableWidth(bounds: RectBounds): number {
		return bounds.right - bounds.left - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2;
	}

	public prepareLayout(bounds: RectBounds): PanelLayout {
		this.cachedLayout = writeProblemsPanelLayout(bounds, this.layout);
		this.lastAvailableWidth = this.resolveAvailableWidth(bounds);
		return this.layout;
	}

	public getItemLayout(index: number, availableWidth = this.lastAvailableWidth): ProblemsPanelItemLayout {
		const itemLayout = this.itemLayouts.get(index);
		return writeProblemsPanelItemLayout(itemLayout, this.diagnostics[index], this.resolvePanelWidth(availableWidth));
	}

	public setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
		this.diagnostics = diagnostics as EditorDiagnostic[];
		this.headerLabel = `PROBLEMS (${diagnostics.length})`;
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
		if (this.focused && this.selectionIndex >= 0) {
			this.revealSelection(layout, this.lastAvailableWidth);
		}
		drawProblemsPanelSurface(
			this,
			bounds,
			layout,
		);
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, _justReleased: boolean, bounds: RectBounds): boolean {
		return handleProblemsPanelPointerInput(this, snapshot, justPressed, bounds);
	}

	public handlePointerWheel(direction: number, steps: number): boolean {
		return handleProblemsPanelWheelInput(this, direction, steps);
	}

	public handleKeyboard(): void {
		handleProblemsPanelKeyboardInput(this);
	}

	public handleKeyboardCommand(command: ProblemsPanelCommand): boolean {
		return handleProblemsPanelNavigationCommand(this, command);
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
		for (let index = this.scrollIndex; index < this.diagnostics.length; index += 1) {
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
			this.scrollIndex = clampProblemsPanelScrollIndex(this.scrollIndex, this.diagnostics.length);
			return;
		}
		if (selectionIndex < this.scrollIndex) {
			this.scrollIndex = selectionIndex;
			return;
		}
		const viewportHeight = layout.contentBottom - layout.contentTop;
		let nextScrollIndex = this.scrollIndex;
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
		this.scrollIndex = clampProblemsPanelScrollIndex(nextScrollIndex, this.diagnostics.length);
	}

	private ensureSelectionValidity(): void {
		this.selectionIndex = findProblemsPanelPreferredSelection(this.diagnostics, this.selectionIndex);
		this.scrollIndex = clampProblemsPanelScrollIndex(this.scrollIndex, this.diagnostics.length);
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
export function toggleProblemsPanel(): void {
	if (problemsPanel.isVisible) {
		hideProblemsPanel();
		return;
	}
	showProblemsPanel();
}

export function showProblemsPanel(): void {
	problemsPanel.show();
	markAllDiagnosticsDirty();
	// problemsPanel.setFocused(true);
}

export function hideProblemsPanel(): void {
	problemsPanel.hide();
	problemsPanel.setFocused(false);
	resetBlink();
}
