import type { EditorDiagnostic } from '../../../../common/models';
import type { RectBounds } from '../../../../../rompack/format';
import { wrapTextDynamic as wrapMessageLinesGeneric } from '../../../../common/text';
import { measureText } from '../../../../editor/common/text_layout';
import { clamp } from '../../../../../common/clamp';
import { getVisibleProblemsPanelHeight, statusAreaHeight, getTabBarTotalHeight } from '../../../common/layout';
import * as constants from '../../../../common/constants';
import { problemsPanel } from './controller';
import { editorViewState } from '../../../../editor/ui/view/state';

export type PanelLayout = {
	headerTop: number;
	headerBottom: number;
	contentTop: number;
	contentBottom: number;
	visibleHeight: number;
};

const panelBoundsScratch: RectBounds = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};

function renderSeverityLabel(severity: 'none' | 'error' | 'warning'): string {
	switch (severity) {
		case 'error': return 'E';
		case 'warning': return 'W';
		default: return '';
	}
}

export function problemsPanelHeaderHeight(): number {
	return editorViewState.lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
}

function targetVisibleRows(diagnosticCount: number): number {
	if (diagnosticCount === 0) {
		return constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS;
	}
	return clamp(
		diagnosticCount,
		constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS,
		constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS,
	);
}

export function computeProblemsPanelVisibleHeight(diagnosticCount: number, fixedHeightPx: number): number {
	const headerHeight = problemsPanelHeaderHeight();
	if (fixedHeightPx && fixedHeightPx > headerHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2) {
		return fixedHeightPx;
	}
	const contentHeight = Math.max(editorViewState.lineHeight, targetVisibleRows(diagnosticCount) * editorViewState.lineHeight);
	return headerHeight + contentHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2;
}

export function computeProblemsPanelLayout(bounds: RectBounds): PanelLayout {
	const headerTop = bounds.top;
	const headerBottom = headerTop + problemsPanelHeaderHeight();
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

export function computeProblemsPanelItemHeight(diagnostic: EditorDiagnostic, availableWidth: number): number {
	const severityLabel = renderSeverityLabel(diagnostic.severity);
	const severityWidth = severityLabel ? measureText(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS : 0;
	const firstLineWidth = Math.max(0, availableWidth - severityWidth);
	const message = diagnostic.message.length > 0 ? diagnostic.message : '(no details)';
	const lines = wrapMessageLinesGeneric(message, firstLineWidth, availableWidth, (text) => measureText(text), constants.PROBLEMS_PANEL_MAX_WRAP_LINES);
	return Math.max(editorViewState.lineHeight, lines.length * editorViewState.lineHeight);
}

export function estimateProblemsPanelVisibleCount(
	diagnostics: readonly EditorDiagnostic[],
	scrollIndex: number,
	layout: PanelLayout,
	availableWidth: number,
): number {
	if (diagnostics.length === 0) {
		return 0;
	}
	const width = Math.max(1, availableWidth);
	let usedHeight = 0;
	let count = 0;
	for (let index = scrollIndex; index < diagnostics.length; index += 1) {
		const itemHeight = computeProblemsPanelItemHeight(diagnostics[index], width);
		if (itemHeight <= 0 || usedHeight + itemHeight > layout.contentBottom - layout.contentTop) {
			break;
		}
		usedHeight += itemHeight;
		count += 1;
	}
	return Math.max(1, count);
}

export function ensureProblemsPanelSelectionWithinView(
	selectionIndex: number,
	scrollIndex: number,
	diagnostics: readonly EditorDiagnostic[],
	layout: PanelLayout,
	availableWidth: number,
): number {
	if (selectionIndex === -1) {
		return clamp(scrollIndex, 0, Math.max(0, diagnostics.length - 1));
	}
	if (selectionIndex < scrollIndex) {
		return selectionIndex;
	}
	const viewportHeight = layout.contentBottom - layout.contentTop;
	const panelWidth = Math.max(1, availableWidth);
	let nextScrollIndex = scrollIndex;
	let usedHeight = 0;
	for (let index = nextScrollIndex; index <= selectionIndex; index += 1) {
		const itemHeight = computeProblemsPanelItemHeight(diagnostics[index], panelWidth);
		if (index < selectionIndex) {
			usedHeight += itemHeight;
			continue;
		}
		while (usedHeight + itemHeight > viewportHeight && nextScrollIndex < selectionIndex) {
			usedHeight -= computeProblemsPanelItemHeight(diagnostics[nextScrollIndex], panelWidth);
			nextScrollIndex += 1;
			if (usedHeight < 0) {
				usedHeight = 0;
			}
		}
	}
	return clamp(nextScrollIndex, 0, Math.max(0, diagnostics.length - 1));
}

export function clampProblemsPanelScrollIndex(scrollIndex: number, diagnosticCount: number): number {
	return clamp(scrollIndex, 0, Math.max(0, diagnosticCount - 1));
}

export function findProblemsPanelPreferredSelection(
	diagnostics: readonly EditorDiagnostic[],
	selectionIndex: number,
): number {
	if (diagnostics.length === 0) {
		return -1;
	}
	if (selectionIndex >= 0 && selectionIndex < diagnostics.length) {
		return selectionIndex;
	}
	for (let index = 0; index < diagnostics.length; index += 1) {
		if (diagnostics[index].severity === 'error') {
			return index;
		}
	}
	return 0;
}

export function getProblemsPanelBounds(): RectBounds | null {
	const panelHeight = getVisibleProblemsPanelHeight();
	if (panelHeight <= 0) {
		return null;
	}
	const statusHeight = statusAreaHeight();
	const bottom = editorViewState.viewportHeight - statusHeight;
	const top = bottom - panelHeight;
	if (bottom <= top) {
		return null;
	}
	panelBoundsScratch.left = 0;
	panelBoundsScratch.top = top;
	panelBoundsScratch.right = editorViewState.viewportWidth;
	panelBoundsScratch.bottom = bottom;
	return panelBoundsScratch;
}

export function isPointerOverProblemsPanelDivider(x: number, y: number): boolean {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
	return y >= bounds.top - margin && y <= bounds.top + margin && x >= bounds.left && x <= bounds.right;
}

export function setProblemsPanelHeightFromViewportY(viewportY: number): void {
	const statusHeight = statusAreaHeight();
	const bottom = editorViewState.viewportHeight - statusHeight;
	const minTop = editorViewState.headerHeight + getTabBarTotalHeight() + 1;
	const minHeight = problemsPanelHeaderHeight()
		+ constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2
		+ Math.max(1, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS) * editorViewState.lineHeight;
	const maxTop = Math.max(minTop, bottom - minHeight);
	const top = clamp(viewportY, minTop, maxTop);
	const height = clamp(bottom - top, minHeight, Math.max(minHeight, bottom - minTop));
	problemsPanel.setFixedHeightPx(height);
}
