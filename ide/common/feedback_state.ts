import type { EditorMessageKind, MessageState } from './models';

type EditorFeedbackState = {
	message: MessageState;
	deferredMessageDuration: number;
	editorActive: boolean;
};

export const editorFeedbackState: EditorFeedbackState = {
	message: {
		text: '',
		kind: 'info',
		timer: 0,
		visible: false,
	},
	deferredMessageDuration: null,
	editorActive: false,
};

export function setEditorFeedbackActive(active: boolean): void {
	editorFeedbackState.editorActive = active;
}

export function showEditorMessage(text: string, kind: EditorMessageKind, durationSeconds: number): void {
	const message = editorFeedbackState.message;
	message.text = text;
	message.kind = kind;
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
	showEditorMessage(text, 'warning', durationSeconds);
	if (!editorFeedbackState.editorActive) {
		editorFeedbackState.message.timer = Number.POSITIVE_INFINITY;
		editorFeedbackState.deferredMessageDuration = durationSeconds;
		return;
	}
	editorFeedbackState.deferredMessageDuration = null;
}
