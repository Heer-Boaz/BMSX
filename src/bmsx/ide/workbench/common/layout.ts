import { splitText } from '../../editor/text/source_text';
import { wrapOverlayLine } from '../../editor/common/text_layout';
import { editorViewState } from '../../editor/ui/view_state';
import { editorFeedbackState } from './feedback_state';
import { problemsPanel } from '../contrib/problems/panel/controller';

export function getTabBarTotalHeight(): number {
	return editorViewState.tabBarHeight * Math.max(1, editorViewState.tabBarRowCount);
}

export function topMargin(): number {
	return editorViewState.headerHeight + getTabBarTotalHeight() + 2;
}

export function getStatusMessageLines(): string[] {
	if (!editorFeedbackState.message.visible) {
		return [];
	}
	const rawLines = splitText(editorFeedbackState.message.text);
	const maxWidth = Math.max(editorViewState.viewportWidth - 8, editorViewState.charAdvance);
	const wrappedLines: string[] = [];
	for (let i = 0; i < rawLines.length; i += 1) {
		const wrapped = wrapOverlayLine(rawLines[i], maxWidth);
		for (let j = 0; j < wrapped.length; j += 1) {
			wrappedLines.push(wrapped[j]);
		}
	}
	return wrappedLines.length > 0 ? wrappedLines : [''];
}

export function statusAreaHeight(): number {
	if (!editorFeedbackState.message.visible) {
		return editorViewState.baseBottomMargin;
	}
	return editorViewState.baseBottomMargin + Math.max(1, getStatusMessageLines().length) * editorViewState.lineHeight + 4;
}

export function getVisibleProblemsPanelHeight(): number {
	if (!problemsPanel.isVisible) {
		return 0;
	}
	const planned = problemsPanel.visibleHeight;
	if (planned <= 0) {
		return 0;
	}
	const maxAvailable = Math.max(0, editorViewState.viewportHeight - statusAreaHeight() - (editorViewState.headerHeight + getTabBarTotalHeight()));
	if (maxAvailable <= 0) {
		return 0;
	}
	return Math.min(planned, maxAvailable);
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}
