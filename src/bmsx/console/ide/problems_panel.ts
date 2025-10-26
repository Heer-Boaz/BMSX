import type { BmsxConsoleApi } from '../api';
import type { EditorDiagnostic, PointerSnapshot, RectBounds } from './types';
import * as constants from './constants';
import { clamp } from '../../utils/utils';

type PanelLayout = {
	headerTop: number;
	headerBottom: number;
	contentTop: number;
	contentBottom: number;
	visibleRows: number;
	maxScroll: number;
	rowHeight: number;
};

export interface ProblemsPanelHost {
	lineHeight: number;
	measureText(text: string): number;
	drawText(api: BmsxConsoleApi, text: string, x: number, y: number, color: number): void;
	truncateTextToWidth(text: string, maxWidth: number): string;
	gotoDiagnostic(diagnostic: EditorDiagnostic): void;
}

export class ProblemsPanelController {
	private visible = false;
	private focused = false;
	private diagnostics: EditorDiagnostic[] = [];
	private selectionIndex = -1;
	private hoverIndex = -1;
	private scroll = 0;
	private cachedLayout: PanelLayout | null = null;

	constructor(private readonly host: ProblemsPanelHost) {}

	public isVisible(): boolean {
		return this.visible;
	}

	public isFocused(): boolean {
		return this.focused;
	}

	public getVisibleHeight(): number {
		if (!this.visible) {
			return 0;
		}
		const headerHeight = this.headerHeight();
		const rowHeight = this.rowHeight();
		const targetRows = this.targetVisibleRows();
		const contentHeight = targetRows * rowHeight;
		return headerHeight + contentHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2;
	}

	public toggle(): void {
		if (this.visible) {
			this.hide();
		} else {
			this.show();
		}
	}

	public show(): void {
		if (this.visible) {
			this.focused = true;
			return;
		}
		this.visible = true;
		this.focused = true;
		this.ensureSelectionValidity();
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

	public setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
		this.diagnostics = diagnostics.slice();
		this.ensureSelectionValidity();
 		this.hoverIndex = -1;
		this.cachedLayout = null;
	}

	public draw(api: BmsxConsoleApi, bounds: RectBounds): void {
		if (!this.visible) {
			this.cachedLayout = null;
			return;
		}
		const layout = this.computeLayout(bounds);
		this.cachedLayout = layout;
		this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);

		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_PROBLEMS_PANEL_BACKGROUND);

		// Header/tab area
		api.rectfill(bounds.left, layout.headerTop, bounds.right, layout.headerBottom, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
		api.rectfill(bounds.left, layout.headerBottom - 1, bounds.right, layout.headerBottom, constants.COLOR_PROBLEMS_PANEL_BORDER);
		const count = this.diagnostics.length;
		let errorCount = 0;
		for (let i = 0; i < this.diagnostics.length; i += 1) {
			if (this.diagnostics[i].severity === 'error') {
				errorCount += 1;
			}
		}
		const warningCount = count - errorCount;
		const headerLabel = `PROBLEMS (${count})`;
		const headerX = bounds.left + constants.PROBLEMS_PANEL_HEADER_PADDING_X;
		const headerY = layout.headerTop + constants.PROBLEMS_PANEL_HEADER_PADDING_Y;
		this.host.drawText(api, headerLabel, headerX, headerY, constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT);
		const summaryParts: string[] = [];
		if (errorCount > 0) summaryParts.push(`${errorCount} ERR`);
		if (warningCount > 0) summaryParts.push(`${warningCount} WARN`);
		const summary = summaryParts.join('  ');
		if (summary.length > 0) {
			const summaryWidth = this.host.measureText(summary);
			const summaryX = bounds.right - constants.PROBLEMS_PANEL_HEADER_PADDING_X - summaryWidth;
			this.host.drawText(api, summary, summaryX, headerY, constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT);
		}

		const contentLeft = bounds.left + constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
		const contentRight = bounds.right - constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
		const availableWidth = Math.max(0, contentRight - contentLeft);
		const rowHeight = layout.rowHeight;

		if (this.diagnostics.length === 0) {
			const message = 'No problems detected.';
			const truncated = this.host.truncateTextToWidth(message, availableWidth);
			const rowTop = layout.contentTop;
			this.host.drawText(api, truncated, contentLeft, rowTop, constants.COLOR_PROBLEMS_PANEL_TEXT);
			return;
		}

		const startIndex = this.scroll;
		const renderableCount = Math.min(layout.visibleRows, this.diagnostics.length - startIndex);
		for (let drawRow = 0; drawRow < renderableCount; drawRow += 1) {
			const diagIndex = startIndex + drawRow;
			const rowTop = layout.contentTop + drawRow * rowHeight;
			const rowBottom = rowTop + rowHeight;

			const diagnostic = this.diagnostics[diagIndex];
			const severity = diagnostic.severity;
			const line = diagnostic.row + 1;
			const column = diagnostic.startColumn + 1;
			const locationText = `Ln ${line}, Col ${column}`;
			const messageText = diagnostic.message.length > 0 ? diagnostic.message : '(no details)';
			const isSelected = diagIndex === this.selectionIndex;
			const isHovered = diagIndex === this.hoverIndex;
			if (isSelected || isHovered) {
				const overlay = constants.SELECTION_OVERLAY;
				api.rectfillColor(bounds.left, rowTop, bounds.right, rowBottom, overlay);
			}
			const severityLabel = this.renderSeverityLabel(severity);
			let textCursorX = contentLeft;
			if (severityLabel) {
				this.host.drawText(api, severityLabel, textCursorX, rowTop, this.severityColor(severity));
				textCursorX += this.host.measureText(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS;
			}
			if (locationText.length > 0) {
				this.host.drawText(api, locationText, textCursorX, rowTop, constants.COLOR_PROBLEMS_PANEL_LOCATION);
				textCursorX += this.host.measureText(locationText) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS;
			}
			const remainingWidth = Math.max(0, contentRight - textCursorX);
			const truncated = this.host.truncateTextToWidth(messageText, remainingWidth);
			this.host.drawText(api, truncated, textCursorX, rowTop, constants.COLOR_PROBLEMS_PANEL_TEXT);
		}

		// Border line separating panel and status bar
		api.rectfill(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, constants.COLOR_PROBLEMS_PANEL_BORDER);
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, _justReleased: boolean, bounds: RectBounds): boolean {
		if (!this.visible) {
			return false;
		}
		const layout = this.computeLayout(bounds);
		this.cachedLayout = layout;
		const inside =
			snapshot.valid
			&& snapshot.insideViewport
			&& snapshot.viewportX >= bounds.left
			&& snapshot.viewportX < bounds.right
			&& snapshot.viewportY >= bounds.top
			&& snapshot.viewportY < bounds.bottom;
		if (!inside) {
			if (justPressed) {
				this.setFocused(false);
			}
			if (!snapshot.primaryPressed) {
				this.hoverIndex = -1;
			}
			return false;
		}
		this.setFocused(true);
		if (snapshot.viewportY < layout.headerBottom) {
			return true;
		}
		if (this.diagnostics.length === 0) {
			this.hoverIndex = -1;
			if (justPressed) {
				this.selectionIndex = -1;
			}
			return true;
		}
		const relativeY = snapshot.viewportY - layout.contentTop;
		const row = Math.floor(relativeY / layout.rowHeight);
		if (row < 0 || row >= layout.visibleRows) {
			if (!snapshot.primaryPressed) {
				this.hoverIndex = -1;
			}
			return true;
		}
		const diagnosticIndex = this.scroll + row;
		if (diagnosticIndex >= this.diagnostics.length) {
			this.hoverIndex = -1;
			return true;
		}
		this.hoverIndex = diagnosticIndex;
		if (justPressed) {
			this.selectionIndex = diagnosticIndex;
			this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);
			this.host.gotoDiagnostic(this.diagnostics[diagnosticIndex]);
		}
		return true;
	}

	public handlePointerWheel(direction: number, steps: number): boolean {
		if (!this.visible || !this.cachedLayout) {
			return false;
		}
		const layout = this.cachedLayout;
		if (layout.maxScroll <= 0) {
			return false;
		}
		const newScroll = clamp(this.scroll + direction * steps, 0, layout.maxScroll);
		if (newScroll === this.scroll) {
			return false;
		}
		this.scroll = newScroll;
		if (this.selectionIndex !== -1) {
			this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);
		}
		return true;
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
					this.host.gotoDiagnostic(this.diagnostics[this.selectionIndex]);
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
				this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);
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
				this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);
				return true;
			case 'page-up':
			case 'page-down': {
				if (this.diagnostics.length === 0) {
					return false;
				}
				const step = Math.max(1, layout.visibleRows - 1);
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
				this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);
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
				this.ensureSelectionWithinScroll(layout.visibleRows, layout.maxScroll);
				return true;
			}
			default:
				return false;
		}
	}

	private computeLayout(bounds: RectBounds): PanelLayout {
		const headerTop = bounds.top;
		const headerBottom = headerTop + this.headerHeight();
		const contentTop = headerBottom;
		const contentBottom = bounds.bottom - constants.PROBLEMS_PANEL_CONTENT_PADDING_Y;
		const rowHeight = this.rowHeight();
		const rawContentHeight = Math.max(0, contentBottom - contentTop - constants.PROBLEMS_PANEL_CONTENT_PADDING_Y);
		const maxRows = Math.max(1, Math.floor(rawContentHeight / rowHeight));
		const visibleRows = this.clampVisibleRows(maxRows);
		const maxScroll = Math.max(0, this.diagnostics.length - visibleRows);
		return {
			headerTop,
			headerBottom,
			contentTop: contentTop + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y,
			contentBottom,
			visibleRows,
			maxScroll,
			rowHeight,
		};
	}

	private clampVisibleRows(maxRows: number): number {
		if (this.diagnostics.length === 0) {
			return clamp(this.targetVisibleRows(), 1, Math.max(1, maxRows));
		}
		const minRows = Math.min(constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS, this.diagnostics.length);
		const base = Math.min(this.targetVisibleRows(), Math.max(1, maxRows));
		return clamp(base, minRows, Math.max(minRows, Math.min(constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS, Math.max(1, maxRows))));
	}

	private targetVisibleRows(): number {
		if (this.diagnostics.length === 0) {
			return constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS;
		}
		return clamp(
			this.diagnostics.length,
			constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS,
			constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS,
		);
	}

	private headerHeight(): number {
		return this.host.lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
	}

	private rowHeight(): number {
		return this.host.lineHeight;
	}

	private ensureSelectionValidity(): void {
		if (this.diagnostics.length === 0) {
			this.selectionIndex = -1;
			this.scroll = 0;
			return;
		}
		let preferred = this.selectionIndex;
		if (preferred < 0 || preferred >= this.diagnostics.length) {
			const firstError = this.diagnostics.findIndex(diag => diag.severity === 'error');
			preferred = firstError >= 0 ? firstError : 0;
		}
		this.selectionIndex = preferred;
		this.scroll = clamp(this.scroll, 0, Math.max(0, this.diagnostics.length - 1));
	}

	private ensureSelectionWithinScroll(visibleRows: number, maxScroll: number): void {
		if (this.selectionIndex === -1) {
			this.scroll = clamp(this.scroll, 0, maxScroll);
			return;
		}
		if (this.selectionIndex < this.scroll) {
			this.scroll = this.selectionIndex;
		} else if (this.selectionIndex >= this.scroll + visibleRows) {
			this.scroll = this.selectionIndex - visibleRows + 1;
		}
		this.scroll = clamp(this.scroll, 0, maxScroll);
	}

	private renderSeverityLabel(severity: 'none' | 'error' | 'warning'): string {
		switch (severity) {
			case 'error': return 'E';
			case 'warning': return 'W';
			default: return '';
		}
	}

	private severityColor(severity: 'none' | 'error' | 'warning'): number {
		switch (severity) {
			case 'error':
				return constants.COLOR_DIAGNOSTIC_ERROR;
			case 'warning':
				return constants.COLOR_DIAGNOSTIC_WARNING;
			default:
				return constants.COLOR_PROBLEMS_PANEL_TEXT;
		}
	}
}
