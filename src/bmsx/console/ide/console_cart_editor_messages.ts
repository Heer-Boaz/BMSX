import * as constants from './constants';
import type { MessageState } from './types';

export type MessageControllerDeps = {
	isActive: () => boolean;
	getDeferredDuration: () => number | null;
	setDeferredDuration: (value: number | null) => void;
};

export type MessageController = {
	message: MessageState;
	showMessage: (text: string, color: number, durationSeconds: number) => void;
	updateMessage: (deltaSeconds: number) => void;
	showWarningBanner: (text: string, durationSeconds?: number) => void;
};

export function createMessageController(deps: MessageControllerDeps): MessageController {
	const message: MessageState = {
		text: '',
		color: constants.COLOR_STATUS_TEXT,
		timer: 0,
		visible: false,
	};

	function showMessage(text: string, color: number, durationSeconds: number): void {
		message.text = text;
		message.color = color;
		message.timer = durationSeconds;
		message.visible = true;
	}

	function updateMessage(deltaSeconds: number): void {
		if (!message.visible) {
			return;
		}
		message.timer -= deltaSeconds;
		if (message.timer <= 0) {
			message.visible = false;
		}
	}

	function showWarningBanner(text: string, durationSeconds = 4.0): void {
		showMessage(text, constants.COLOR_STATUS_WARNING, durationSeconds);
		if (!deps.isActive()) {
			message.timer = Number.POSITIVE_INFINITY;
			deps.setDeferredDuration(durationSeconds);
		} else {
			deps.setDeferredDuration(null);
		}
	}

	return {
		message,
		showMessage,
		updateMessage,
		showWarningBanner,
	};
}
