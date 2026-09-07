import type { Clipboard } from '../common/clipboard';
import * as constants from '../common/constants';
import { showEditorMessage } from '../common/feedback_state';

/** Shared input feedback; the clipboard provider owns both its cache and OS write. */
export async function writeClipboard(clipboard: Clipboard, text: string, successMessage: string): Promise<void> {
	try {
		await clipboard.writeText(text);
		const message = clipboard.isSupported() ? successMessage : successMessage + ' (Editor clipboard only)';
		showEditorMessage(message, constants.COLOR_STATUS_SUCCESS, 1.5);
	} catch {
		showEditorMessage('System clipboard write failed. Editor clipboard updated.', constants.COLOR_STATUS_WARNING, 3.5);
	}
}
