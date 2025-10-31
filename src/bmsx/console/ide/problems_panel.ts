import type { BmsxConsoleApi } from '../api';
import type { EditorDiagnostic, PointerSnapshot } from './types';
import type { RectBounds } from '../../rompack/rompack.ts';
import * as constants from './constants';
import { wrapTextDynamic as wrapMessageLinesGeneric } from './text_utils_local';
import { clamp } from '../../utils/utils';

type PanelLayout = {
    headerTop: number;
    headerBottom: number;
    contentTop: number;
    contentBottom: number;
    visibleHeight: number;
};

export interface ProblemsPanelHost {
	lineHeight: number;
	measureText(text: string): number;
	drawText(api: BmsxConsoleApi, text: string, x: number, y: number, color: number): void;
	drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void;
	truncateTextToWidth(text: string, maxWidth: number): string;
	gotoDiagnostic(diagnostic: EditorDiagnostic): void;
}

export class ProblemsPanelController {
    private visible = false;
    private focused = false;
    private diagnostics: EditorDiagnostic[] = [];
    private selectionIndex = -1;
    private hoverIndex = -1;
    private scrollIndex = 0;
    private cachedLayout: PanelLayout | null = null;
    private fixedHeightPx: number | null = null;
    private lastAvailableWidth = 0;

	constructor(private readonly host: ProblemsPanelHost) {}

	public isVisible(): boolean {
		return this.visible;
	}

	public isFocused(): boolean {
		return this.focused;
	}

    public getSelectedDiagnostic(): EditorDiagnostic | null {
        if (this.selectionIndex < 0 || this.selectionIndex >= this.diagnostics.length) return null;
        return this.diagnostics[this.selectionIndex];
    }

    public getVisibleHeight(): number {
        if (!this.visible) return 0;
        const headerHeight = this.headerHeight();
        if (this.fixedHeightPx && this.fixedHeightPx > headerHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2) {
            return this.fixedHeightPx;
        }
        // Default height based on heuristics and item count
        const baseRows = this.targetVisibleRows();
        const lineHeight = this.host.lineHeight;
        const contentHeight = Math.max(lineHeight, baseRows * lineHeight);
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

		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_PROBLEMS_PANEL_BACKGROUND);

		// Header/tab area
		api.rectfill(bounds.left, layout.headerTop, bounds.right, layout.headerBottom, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
		api.rectfill(bounds.left, layout.headerBottom - 1, bounds.right, layout.headerBottom, constants.COLOR_PROBLEMS_PANEL_BORDER);
		const count = this.diagnostics.length;
		const headerLabel = `PROBLEMS (${count})`;
		const headerX = bounds.left + constants.PROBLEMS_PANEL_HEADER_PADDING_X;
		const headerY = layout.headerTop + constants.PROBLEMS_PANEL_HEADER_PADDING_Y;
		this.host.drawText(api, headerLabel, headerX, headerY, constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT);
        // Right-aligned ERR/WARN summary removed per requirement

		const contentLeft = bounds.left + constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
        const contentRight = bounds.right - constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
        const availableWidth = Math.max(0, contentRight - contentLeft);
        this.lastAvailableWidth = availableWidth;
        if (this.focused && this.selectionIndex >= 0) this.ensureSelectionWithinView(layout, availableWidth);
        const lineHeight = this.host.lineHeight;

		if (this.diagnostics.length === 0) {
			const message = 'No problems detected.';
			const truncated = this.host.truncateTextToWidth(message, availableWidth);
			const rowTop = layout.contentTop;
			this.host.drawText(api, truncated, contentLeft, rowTop, constants.COLOR_PROBLEMS_PANEL_TEXT);
			return;
		}

        // Render variable-height items from scrollIndex until we fill visible height
        let cursorY = layout.contentTop;
        const maxY = layout.contentBottom;
        for (let diagIndex = this.scrollIndex; diagIndex < this.diagnostics.length && cursorY < maxY; diagIndex += 1) {
            const rowTop = cursorY;
            const diagnostic = this.diagnostics[diagIndex];
            const severity = diagnostic.severity;
            // line/column displayed in status bar when focused; not drawn in list
            const baseMessage = diagnostic.message.length > 0 ? diagnostic.message : '(no details)';
            const isSelected = diagIndex === this.selectionIndex;
            // Hover highlight should show regardless of focus
            const isHovered = diagIndex === this.hoverIndex;
            const severityLabel = this.renderSeverityLabel(severity);
            const severityWidth = severityLabel ? this.host.measureText(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS : 0;
            // Only severity label is drawn; message uses remaining width
            const firstLineMessageWidth = Math.max(0, availableWidth - severityWidth);

            // Wrap message across variable lines
            const wrapped = wrapMessageLinesGeneric(baseMessage, firstLineMessageWidth, availableWidth, (t) => this.host.measureText(t), constants.PROBLEMS_PANEL_MAX_WRAP_LINES);
            const rowHeight = Math.max(lineHeight, wrapped.length * lineHeight);
            const rowBottom = rowTop + rowHeight;
            // Selection presentation depends on focus
            if (isSelected) {
                if (this.focused) {
                    const overlay = constants.SELECTION_OVERLAY;
                    api.rectfill_color(bounds.left, rowTop, bounds.right, rowBottom, overlay);
                } else {
                    this.host.drawRectOutlineColor(api, bounds.left, rowTop, bounds.right, rowBottom, { r: 1, g: 1, b: 1, a: 1 });
                }
            }
            let textCursorX = contentLeft;
            if (severityLabel) {
                const sevColor = isHovered && !isSelected ? constants.COLOR_PROBLEMS_PANEL_HOVER_TEXT : this.severityColor(severity);
                this.host.drawText(api, severityLabel, textCursorX, rowTop, sevColor);
                textCursorX += severityWidth;
            }
            // Do not display location/source in the list; leave space for message
            const messageColor = isSelected && this.focused
                ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT
                : (isHovered ? constants.COLOR_PROBLEMS_PANEL_HOVER_TEXT : constants.COLOR_PROBLEMS_PANEL_TEXT);
            for (let li = 0; li < wrapped.length; li += 1) {
                const y = rowTop + li * this.host.lineHeight;
                const x = li === 0 ? textCursorX : contentLeft;
                this.host.drawText(api, wrapped[li], x, y, messageColor);
            }
            cursorY = rowBottom;
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
        // Do not take focus on hover; only on click inside the panel
        if (justPressed) this.setFocused(true);
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
        // Map y to item index considering variable heights
        let y = 0;
        let diagnosticIndex = this.scrollIndex;
        while (diagnosticIndex < this.diagnostics.length) {
            const h = this.computeItemHeight(this.diagnostics[diagnosticIndex], Math.max(0, (bounds.right - bounds.left) - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2));
            if (relativeY < y + h) break;
            y += h;
            diagnosticIndex += 1;
            if (layout.contentTop + y >= layout.contentBottom) break;
        }
        if (diagnosticIndex >= this.diagnostics.length) {
            this.hoverIndex = -1;
            return true;
        }
        this.hoverIndex = diagnosticIndex;
        if (justPressed) {
            this.selectionIndex = diagnosticIndex;
            this.ensureSelectionWithinView(layout, Math.max(0, (bounds.right - bounds.left) - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2));
            this.host.gotoDiagnostic(this.diagnostics[diagnosticIndex]);
        }
        return true;
    }

    public handlePointerWheel(direction: number, steps: number): boolean {
        if (!this.visible || !this.cachedLayout) {
            return false;
        }
        // Advance by approximately 'steps' rows worth of pixels, accounting for variable heights
        const panelWidth = this.cachedPanelWidth();
        let advance = 0;
        let pixels = Math.max(1, steps) * this.host.lineHeight;
        if (direction > 0) {
            let idx = this.scrollIndex;
            while (idx < this.diagnostics.length - 1 && pixels > 0) {
                const h = this.computeItemHeight(this.diagnostics[idx], panelWidth);
                pixels -= Math.max(1, h);
                idx += 1;
                advance += 1;
            }
        } else if (direction < 0) {
            let idx = this.scrollIndex - 1;
            while (idx >= 0 && pixels > 0) {
                const h = this.computeItemHeight(this.diagnostics[idx], panelWidth);
                pixels -= Math.max(1, h);
                idx -= 1;
                advance += 1;
            }
        }
        if (advance === 0) advance = 1;
        const newScroll = clamp(this.scrollIndex + (direction > 0 ? advance : -advance), 0, Math.max(0, this.diagnostics.length - 1));
        if (newScroll === this.scrollIndex) {
            return false;
        }
        this.scrollIndex = newScroll;
        // Do not force selection into view on wheel scroll; allow free scrolling
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
                this.ensureSelectionWithinView(layout, this.cachedPanelWidth());
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
                this.ensureSelectionWithinView(layout, this.cachedPanelWidth());
                return true;
            case 'page-up':
            case 'page-down': {
                if (this.diagnostics.length === 0) {
                    return false;
                }
                // Approximate page step by filling the panel height
                const step = Math.max(1, this.estimateVisibleCount(layout));
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
                this.ensureSelectionWithinView(layout, this.cachedPanelWidth());
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
				this.ensureSelectionWithinView(layout, this.cachedPanelWidth());
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
        const visibleHeight = Math.max(0, contentBottom - contentTop - constants.PROBLEMS_PANEL_CONTENT_PADDING_Y);
        return {
            headerTop,
            headerBottom,
            contentTop: contentTop + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y,
            contentBottom,
            visibleHeight,
        };
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

    public setFixedHeightPx(height: number | null): void { this.fixedHeightPx = (height && height > 0) ? Math.floor(height) : null; this.cachedLayout = null; }

    private estimateVisibleCount(layout: PanelLayout): number {
        // Estimate how many items fit from current selection based on cached heights
        if (this.diagnostics.length === 0) return 0;
        const width = this.cachedPanelWidth();
        let h = 0;
        let count = 0;
        for (let i = this.scrollIndex; i < this.diagnostics.length; i += 1) {
            const ih = this.computeItemHeight(this.diagnostics[i], width);
            if (ih <= 0) break;
            if (h + ih > (layout.contentBottom - layout.contentTop)) break;
            h += ih;
            count += 1;
        }
        return Math.max(1, count);
    }

    private computeItemHeight(d: EditorDiagnostic, availableWidth: number): number {
        const lineHeight = this.host.lineHeight;
        const severityLabel = this.renderSeverityLabel(d.severity);
        const severityWidth = severityLabel ? this.host.measureText(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS : 0;
        const firstLineWidth = Math.max(0, availableWidth - severityWidth);
        const msg = d.message.length > 0 ? d.message : '(no details)';
        const lines = wrapMessageLinesGeneric(msg, firstLineWidth, availableWidth, (t) => this.host.measureText(t), constants.PROBLEMS_PANEL_MAX_WRAP_LINES);
        return Math.max(lineHeight, lines.length * lineHeight);
    }

    private ensureSelectionWithinView(layout: PanelLayout, availableWidth: number): void {
        if (this.selectionIndex === -1) {
            this.scrollIndex = clamp(this.scrollIndex, 0, Math.max(0, this.diagnostics.length - 1));
            return;
        }
        if (this.selectionIndex < this.scrollIndex) {
            this.scrollIndex = this.selectionIndex;
        } else {
            // If selection is below the visible window, advance scroll until it fits
            const viewportHeight = layout.contentBottom - layout.contentTop;
            const panelWidth = Math.max(1, availableWidth || this.cachedPanelWidth());
            let h = 0;
            for (let i = this.scrollIndex; i <= this.selectionIndex; i += 1) {
                const ih = this.computeItemHeight(this.diagnostics[i], panelWidth);
                if (i < this.selectionIndex) h += ih;
                else {
                    // selection item height is ih; ensure h + ih <= viewportHeight
                    while (h + ih > viewportHeight && this.scrollIndex < this.selectionIndex) {
                        const headH = this.computeItemHeight(this.diagnostics[this.scrollIndex], panelWidth);
                        this.scrollIndex += 1;
                        h -= headH;
                        if (h < 0) h = 0;
                    }
                }
            }
        }
        this.scrollIndex = clamp(this.scrollIndex, 0, Math.max(0, this.diagnostics.length - 1));
    }

    private cachedPanelWidth(): number { return Math.max(1, this.lastAvailableWidth); }

	private ensureSelectionValidity(): void {
        if (this.diagnostics.length === 0) { this.selectionIndex = -1; this.scrollIndex = 0; return; }
		let preferred = this.selectionIndex;
		if (preferred < 0 || preferred >= this.diagnostics.length) {
			const firstError = this.diagnostics.findIndex(diag => diag.severity === 'error');
			preferred = firstError >= 0 ? firstError : 0;
		}
        this.selectionIndex = preferred;
        this.scrollIndex = clamp(this.scrollIndex, 0, Math.max(0, this.diagnostics.length - 1));
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
