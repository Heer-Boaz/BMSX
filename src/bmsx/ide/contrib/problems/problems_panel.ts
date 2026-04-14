import type { EditorDiagnostic, PointerSnapshot } from '../../core/types';
import type { RectBounds } from '../../../rompack/rompack';
import { clamp } from '../../../utils/clamp';
import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { markAllDiagnosticsDirty } from './diagnostics';
import { resetBlink } from '../../render/render_caret';
import { gotoDiagnostic } from './diagnostics_controller';
import {
	clampProblemsPanelScrollIndex,
	computeProblemsPanelLayout,
	computeProblemsPanelVisibleHeight,
	ensureProblemsPanelSelectionWithinView,
	estimateProblemsPanelVisibleCount,
	findProblemsPanelPreferredSelection,
	type PanelLayout,
	getProblemsPanelBounds,
} from './problems_panel_layout';
import { drawProblemsPanelSurface } from './problems_panel_render';
import { handleProblemsPanelKeyboardInput } from './problems_panel_keyboard';
import { handleProblemsPanelPointerInput, handleProblemsPanelWheelInput } from './problems_panel_pointer';

export {
	getProblemsPanelBounds,
	isPointerOverProblemsPanelDivider,
	setProblemsPanelHeightFromViewportY,
} from './problems_panel_layout';

const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];

export class ProblemsPanelController {
	private visible = false;
	private focused = false;
	private diagnostics: EditorDiagnostic[] = EMPTY_DIAGNOSTICS;
	private selectionIndex = -1;
	private hoverIndex = -1;
	private scrollIndex = 0;
	private cachedLayout: PanelLayout = null;
	private fixedHeightPx: number = null;
	private lastAvailableWidth = 0;

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

	public getScrollIndex(): number {
		return this.scrollIndex;
	}

	public setScrollIndex(index: number): void {
		this.scrollIndex = index;
	}

	public getCachedLayout(): PanelLayout {
		return this.cachedLayout;
	}

	public updateCachedLayout(layout: PanelLayout): void {
		this.cachedLayout = layout;
	}

	public setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
		this.diagnostics = diagnostics as EditorDiagnostic[];
		this.ensureSelectionValidity();
		this.hoverIndex = -1;
		this.cachedLayout = null;
	}

	public draw(bounds: RectBounds): void {
		if (!this.visible) {
			this.cachedLayout = null;
			return;
		}
		const layout = computeProblemsPanelLayout(bounds);
		this.cachedLayout = layout;
		const availableWidth = Math.max(0, bounds.right - bounds.left - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2);
		if (this.focused && this.selectionIndex >= 0) {
			this.revealSelection(layout, this.resolvePanelWidth(availableWidth));
		}
		this.lastAvailableWidth = drawProblemsPanelSurface(
			this.diagnostics,
			this.selectionIndex,
			this.hoverIndex,
			this.focused,
			this.scrollIndex,
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

	public handleKeyboardCommand(command: 'up' | 'down' | 'page-up' | 'page-down' | 'home' | 'end' | 'activate'): boolean {
		if (!this.visible || !this.focused) {
			return false;
		}
		const layout = this.cachedLayout;
		if (!layout) {
			return false;
		}
		switch (command) {
			case 'activate':
				if (this.selectionIndex >= 0 && this.selectionIndex < this.diagnostics.length) {
					gotoDiagnostic(this.diagnostics[this.selectionIndex]);
					return true;
				}
				return false;
			case 'home':
				if (this.diagnostics.length === 0) {
					return false;
				}
				if (this.selectionIndex === 0) {
					return false;
				}
				this.selectionIndex = 0;
				this.revealSelection(layout, this.resolvePanelWidth());
				return true;
			case 'end':
				if (this.diagnostics.length === 0) {
					return false;
				}
				const lastIndex = this.diagnostics.length - 1;
				if (this.selectionIndex === lastIndex) {
					return false;
				}
				this.selectionIndex = lastIndex;
				this.revealSelection(layout, this.resolvePanelWidth());
				return true;
			case 'page-up':
			case 'page-down': {
				if (this.diagnostics.length === 0) {
					return false;
				}
				// Approximate page step by filling the panel height
				const step = Math.max(1, estimateProblemsPanelVisibleCount(this.diagnostics, this.scrollIndex, layout, this.resolvePanelWidth()));
				const delta = command === 'page-up' ? -step : step;
				const nextIndex = clamp(
					this.selectionIndex === -1 ? (delta > 0 ? 0 : this.diagnostics.length - 1) : this.selectionIndex + delta,
					0,
					this.diagnostics.length - 1,
				);
				if (nextIndex === this.selectionIndex) {
					return false;
				}
				this.selectionIndex = nextIndex;
				this.revealSelection(layout, this.resolvePanelWidth());
				return true;
			}
			case 'up':
			case 'down': {
				if (this.diagnostics.length === 0) {
					return false;
				}
				const delta = command === 'up' ? -1 : 1;
				const baseIndex = this.selectionIndex === -1 ? (delta > 0 ? -1 : this.diagnostics.length) : this.selectionIndex;
				const nextIndex = clamp(baseIndex + delta, 0, this.diagnostics.length - 1);
				if (nextIndex === this.selectionIndex) {
					return false;
				}
				this.selectionIndex = nextIndex;
				this.revealSelection(layout, this.resolvePanelWidth());
				return true;
			}
			default:
				return false;
		}
	}

	public setFixedHeightPx(height: number): void { this.fixedHeightPx = height > 0 ? height : null; this.cachedLayout = null; }

	public resolvePanelWidth(width = this.lastAvailableWidth): number { return Math.max(1, width); }

	public revealSelection(layout: PanelLayout, availableWidth: number): void {
		this.scrollIndex = ensureProblemsPanelSelectionWithinView(this.selectionIndex, this.scrollIndex, this.diagnostics, layout, availableWidth);
	}

	private ensureSelectionValidity(): void {
		this.selectionIndex = findProblemsPanelPreferredSelection(this.diagnostics, this.selectionIndex);
		this.scrollIndex = clampProblemsPanelScrollIndex(this.scrollIndex, this.diagnostics.length);
	}
}

export function drawProblemsPanel() {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return null;
	}
	ide_state.problemsPanel.draw(bounds);
	return bounds;
}
export function toggleProblemsPanel(): void {
	if (ide_state.problemsPanel.isVisible) {
		hideProblemsPanel();
		return;
	}
	showProblemsPanel();
}

export function showProblemsPanel(): void {
	ide_state.problemsPanel.show();
	markAllDiagnosticsDirty();
	// ide_state.problemsPanel.setFocused(true);
}

export function hideProblemsPanel(): void {
	ide_state.problemsPanel.hide();
	ide_state.problemsPanel.setFocused(false);
	resetBlink();
}
