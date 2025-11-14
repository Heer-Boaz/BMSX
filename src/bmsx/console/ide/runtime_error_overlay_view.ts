import { pointInRect } from 'bmsx/utils/rect_operations';
import { clamp } from '../../utils/clamp';
import type { BmsxConsoleApi } from '../api';
import type { ConsoleEditorFont } from '../editor_font';
import {
	computeErrorOverlayBounds,
	renderErrorOverlay,
	type ErrorOverlayBounds,
	type ErrorOverlayRenderConfig
} from './render_error_overlay';
import type {
	CachedHighlight,
	RuntimeErrorOverlay} from './types';
import type { StackTraceFrame } from '../../lua/runtime';
import type { RectBounds } from '../../rompack/rompack';

export interface RuntimeErrorOverlayLayoutHost {
	ensureVisualLines(): void;
	positionToVisualIndex(row: number, column: number): number;
	visibleRowCount(): number;
	scrollRow: number;
	visualIndexToSegment(visualIndex: number): { row: number; startColumn: number; endColumn: number } | null;
	getCachedHighlight(rowIndex: number): CachedHighlight;
	wordWrapEnabled: boolean;
	scrollColumn: number;
	visibleColumnCount(): number;
	sliceHighlightedLine(
		highlight: CachedHighlight['hi'],
		columnStart: number,
		columnCount: number,
	): { text: string; colors: number[]; startDisplay: number; endDisplay: number };
	columnToDisplay(highlight: CachedHighlight['hi'], column: number): number;
	measureRangeFast(entry: CachedHighlight, fromDisplay: number, toDisplay: number): number;
	lineHeight: number;
	viewportHeight: number;
	bottomMargin: number;
	measureText(text: string): number;
}

export type RuntimeErrorOverlayLayoutResult = {
    bounds: ErrorOverlayBounds;
    connector?: ErrorOverlayRenderConfig['connector'];
    lineRects: RectBounds[];
    displayLines: string[];
    displayLineMap: number[];
};

export type RuntimeErrorOverlayDrawOptions = {
	textColor: number;
	paddingX: number;
	paddingY: number;
	backgroundColor: { r: number; g: number; b: number; a: number };
	highlightColor: { r: number; g: number; b: number; a: number };
	highlightLines: ReadonlyArray<number> | null;
};

export type RuntimeErrorOverlayClickResult =
	| { kind: 'expand' }
	| { kind: 'collapse' }
	| { kind: 'navigate'; frame: StackTraceFrame }
	| { kind: 'noop' };

export function computeRuntimeErrorOverlayLayout(
    host: RuntimeErrorOverlayLayoutHost,
    overlay: RuntimeErrorOverlay,
    codeTop: number,
    codeRight: number,
    textLeft: number,
    paddingX: number,
    paddingY: number,
    maxTextWidth: number
): RuntimeErrorOverlayLayoutResult | null {
	host.ensureVisualLines();
	const visualIndex = host.positionToVisualIndex(overlay.row, overlay.column);
	const visibleRows = host.visibleRowCount();
	const relativeRow = visualIndex - host.scrollRow;
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		overlay.layout = null;
		return null;
	}
	const segment = host.visualIndexToSegment(visualIndex);
	if (!segment) {
		overlay.layout = null;
		return null;
	}
	const entry = host.getCachedHighlight(segment.row);
	const highlight = entry.hi;
	let columnStart = host.wordWrapEnabled ? segment.startColumn : host.scrollColumn;
	if (host.wordWrapEnabled && (columnStart < segment.startColumn || columnStart > segment.endColumn)) {
		columnStart = segment.startColumn;
	}
	const columnCount = host.wordWrapEnabled
		? Math.max(0, segment.endColumn - columnStart)
		: host.visibleColumnCount() + 4;
	const slice = host.sliceHighlightedLine(highlight, columnStart, columnCount);
	const sliceStartDisplay = slice.startDisplay;
	const sliceEndLimit = host.wordWrapEnabled ? host.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
	const sliceEndDisplay = host.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
	const anchorDisplay = host.columnToDisplay(highlight, overlay.column);
	const clampedAnchorDisplay = clamp(anchorDisplay, sliceStartDisplay, sliceEndDisplay);
	const anchorX = textLeft + host.measureRangeFast(entry, sliceStartDisplay, clampedAnchorDisplay);
	const rowTop = codeTop + relativeRow * host.lineHeight;
    const sourceLines = overlay.lines.length > 0 ? overlay.lines : ['Runtime error'];
    // Wrap lines greedily to fit inside the given max width
    const displayLines: string[] = [];
    const displayLineMap: number[] = [];
    for (let d = 0; d < sourceLines.length; d += 1) {
        const text = sourceLines[d];
        if (text.length === 0) {
            displayLines.push('');
            displayLineMap.push(d);
            continue;
        }
        let current = '';
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charAt(i);
            const candidate = current + ch;
            const w = host.measureText(candidate);
            if (current.length > 0 && w > maxTextWidth) {
                displayLines.push(current);
                displayLineMap.push(d);
                current = ch;
                if (host.measureText(current) > maxTextWidth) {
                    displayLines.push(current);
                    displayLineMap.push(d);
                    current = '';
                }
                continue;
            }
            if (current.length === 0 && w > maxTextWidth) {
                displayLines.push(ch);
                displayLineMap.push(d);
                current = '';
                continue;
            }
            current = candidate;
        }
        if (current.length > 0) {
            displayLines.push(current);
            displayLineMap.push(d);
        }
        if (displayLineMap.length === 0 || displayLineMap[displayLineMap.length - 1] !== d) {
            // Ensure at least one display line per descriptor
            // (needed if a single character was wider than max width and got pushed above)
        }
    }
	const availableBottom = host.viewportHeight - host.bottomMargin;
	const belowTop = rowTop + host.lineHeight + 2;
    const bubbleBounds = computeErrorOverlayBounds(
        anchorX,
        rowTop,
        displayLines,
        (text) => host.measureText(text),
        {
            left: textLeft,
            top: codeTop,
            right: codeRight,
            bottom: availableBottom
        },
        host.lineHeight
    );

	const placedBelow = bubbleBounds.top >= belowTop - 1;
	const connectorLeft = Math.max(textLeft, anchorX);
	const connectorRight = Math.min(bubbleBounds.left, connectorLeft + 3);

	let connector: ErrorOverlayRenderConfig['connector'] = undefined;
	if (connectorRight > connectorLeft) {
		if (placedBelow) {
			const connectorStartY = rowTop + host.lineHeight;
			if (bubbleBounds.top > connectorStartY) {
				connector = {
					left: connectorLeft,
					right: connectorRight,
					startY: connectorStartY,
					endY: bubbleBounds.top
				};
			}
		} else if (bubbleBounds.bottom < rowTop) {
			connector = {
				left: connectorLeft,
				right: connectorRight,
				startY: bubbleBounds.bottom,
				endY: rowTop
			};
		}
	}

	const lineRects: RectBounds[] = [];
	const lineLeft = bubbleBounds.left + paddingX;
	const lineRight = bubbleBounds.right - paddingX;
	let currentY = bubbleBounds.top + paddingY;
    for (let index = 0; index < displayLines.length; index += 1) {
        lineRects.push({ left: lineLeft, top: currentY, right: lineRight, bottom: currentY + host.lineHeight });
        currentY += host.lineHeight;
    }
    overlay.layout = {
        bounds: { left: bubbleBounds.left, top: bubbleBounds.top, right: bubbleBounds.right, bottom: bubbleBounds.bottom },
        lineRects,
        displayLineMap,
        displayLines,
    };
    return { bounds: bubbleBounds, connector, lineRects, displayLines, displayLineMap };
}

export function drawRuntimeErrorOverlay(
	api: BmsxConsoleApi,
	font: ConsoleEditorFont,
	overlay: RuntimeErrorOverlay,
	layout: RuntimeErrorOverlayLayoutResult,
	lineHeight: number,
	options: RuntimeErrorOverlayDrawOptions
): void {
	const highlightLines = options.highlightLines && options.highlightLines.length > 0 ? options.highlightLines : undefined;
    const toDraw = (layout as any).displayLines as string[] | undefined;
    renderErrorOverlay(api, (toDraw && toDraw.length > 0 ? toDraw : (overlay.lines.length > 0 ? overlay.lines : ['Runtime error'])), font, lineHeight, {
        bounds: layout.bounds,
        background: options.backgroundColor,
        textColor: options.textColor,
        paddingX: options.paddingX,
        paddingY: options.paddingY,
        connector: layout.connector,
        highlightLines,
        highlightColor: options.highlightColor,
    });
}

export function findRuntimeErrorOverlayLineAtPosition(overlay: RuntimeErrorOverlay, x: number, y: number): number {
	const layout = overlay.layout;
	if (!layout) {
		return -1;
	}
    for (let index = 0; index < layout.lineRects.length; index += 1) {
        const rect = layout.lineRects[index];
        if (pointInRect(x, y, rect)) {
            const mapping = (layout as any).displayLineMap as number[] | undefined;
            if (Array.isArray(mapping) && index >= 0 && index < mapping.length) {
                return mapping[index];
            }
            return index;
        }
    }
	return -1;
}

export function evaluateRuntimeErrorOverlayClick(
	overlay: RuntimeErrorOverlay,
	hoverLine: number
): RuntimeErrorOverlayClickResult {
	if (!overlay.expanded) {
		return { kind: 'expand' };
	}
	if (hoverLine < 0 || hoverLine >= overlay.lineDescriptors.length) {
		return { kind: 'collapse' };
	}
	const descriptor = overlay.lineDescriptors[hoverLine];
	if (descriptor.role === 'frame' && descriptor.frame) {
		if (descriptor.frame.origin === 'lua') {
			return { kind: 'navigate', frame: descriptor.frame };
		}
		return { kind: 'noop' };
	}
	return { kind: 'collapse' };
}
