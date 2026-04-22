import { writeWrappedOverlayLine } from '../../editor/common/text_layout';
import { editorViewState } from '../../editor/ui/view/state';
import { editorFeedbackState } from '../../common/feedback_state';
import { problemsPanel } from '../contrib/problems/panel/controller';

const statusMessageLines: string[] = [];
let statusMessageCachedVisible = false;
let statusMessageCachedText = '';
let statusMessageCachedMaxWidth = -1;

export function getTabBarTotalHeight(): number {
	const rowCount = editorViewState.tabBarRowCount > 1 ? editorViewState.tabBarRowCount : 1;
	return editorViewState.tabBarHeight * rowCount;
}

export function topMargin(): number {
	return editorViewState.headerHeight + getTabBarTotalHeight() + 2;
}

export function getStatusMessageLines(): string[] {
	writeStatusMessageLines();
	return statusMessageLines;
}

function writeStatusMessageLines(): void {
	const message = editorFeedbackState.message;
	const maxWidthCandidate = editorViewState.viewportWidth - 8;
	const maxWidth = maxWidthCandidate > editorViewState.charAdvance ? maxWidthCandidate : editorViewState.charAdvance;
	if (
		message.visible === statusMessageCachedVisible
		&& message.text === statusMessageCachedText
		&& maxWidth === statusMessageCachedMaxWidth
	) {
		return;
	}

	statusMessageCachedVisible = message.visible;
	statusMessageCachedText = message.text;
	statusMessageCachedMaxWidth = maxWidth;
	statusMessageLines.length = 0;

	if (!message.visible) {
		return;
	}

	const text = message.text;
	let lineStart = 0;
	for (let index = 0; index <= text.length; index += 1) {
		if (index !== text.length && text.charCodeAt(index) !== 10) {
			continue;
		}
		let lineEnd = index;
		if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) {
			lineEnd -= 1;
		}
		writeWrappedOverlayLine(statusMessageLines, text.slice(lineStart, lineEnd), maxWidth);
		lineStart = index + 1;
	}

	if (statusMessageLines.length === 0) {
		statusMessageLines.push('');
	}
}

export function statusAreaHeight(): number {
	if (!editorFeedbackState.message.visible) {
		return editorViewState.baseBottomMargin;
	}
	writeStatusMessageLines();
	const lineCount = statusMessageLines.length > 1 ? statusMessageLines.length : 1;
	return editorViewState.baseBottomMargin + lineCount * editorViewState.lineHeight + 4;
}

export function getVisibleProblemsPanelHeight(): number {
	if (!problemsPanel.isVisible) {
		return 0;
	}
	const planned = problemsPanel.visibleHeight;
	if (planned <= 0) {
		return 0;
	}
	const maxAvailable = editorViewState.viewportHeight - statusAreaHeight() - (editorViewState.headerHeight + getTabBarTotalHeight());
	if (maxAvailable <= 0) {
		return 0;
	}
	return planned < maxAvailable ? planned : maxAvailable;
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}
