import * as constants from '../../common/constants';
import type { MessageState } from '../../common/models';

type EditorFeedbackState = {
	message: MessageState;
	deferredMessageDuration: number;
	warnNonMonospace: boolean;
	editorActive: boolean;
};

export const editorFeedbackState: EditorFeedbackState = {
	message: {
		text: '',
		color: constants.COLOR_STATUS_TEXT,
		timer: 0,
		visible: false,
	},
	deferredMessageDuration: null,
	warnNonMonospace: false,
	editorActive: false,
};

export function setEditorFeedbackActive(active: boolean): void {
	editorFeedbackState.editorActive = active;
}

export function showEditorMessage(text: string, color: number, durationSeconds: number): void {
	const message = editorFeedbackState.message;
	message.text = text;
	message.color = color;
	message.timer = durationSeconds;
	message.visible = true;
}

export function updateEditorMessage(deltaSeconds: number): void {
	const message = editorFeedbackState.message;
	if (!message.visible) {
		return;
	}
	message.timer -= deltaSeconds;
	if (message.timer <= 0) {
		message.visible = false;
	}
}

export function showEditorWarningBanner(text: string, durationSeconds = 4.0): void {
	showEditorMessage(text, constants.COLOR_STATUS_WARNING, durationSeconds);
	if (!editorFeedbackState.editorActive) {
		editorFeedbackState.message.timer = Number.POSITIVE_INFINITY;
		editorFeedbackState.deferredMessageDuration = durationSeconds;
		return;
	}
	editorFeedbackState.deferredMessageDuration = null;
}
