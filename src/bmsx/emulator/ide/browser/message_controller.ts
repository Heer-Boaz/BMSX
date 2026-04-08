import * as constants from '../constants';
import { ide_state } from '../ide_state';
import type { MessageState } from '../types';

export function createMessageController(){
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
		if (!ide_state.active) {
			message.timer = Number.POSITIVE_INFINITY;
			ide_state.deferredMessageDuration = durationSeconds;
		} else {
			ide_state.deferredMessageDuration = null;
		}
	}

	return {
		message,
		showMessage,
		updateMessage,
		showWarningBanner,
	};
}
