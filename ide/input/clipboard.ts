import { clipboardAction, ClipboardAccessError, type Clipboard, type ClipboardAction, type ClipboardTarget } from '../../hosts/common/clipboard';
import type { PlayerInput } from '../../hosts/common/input/player';
import * as constants from '../common/constants';
import { showEditorMessage } from '../common/feedback_state';
import { inputFocus } from './focus';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './keyboard/key_input';

export function reportClipboardFailure(error: ClipboardAccessError): void {
	const operation = error.action === 'cut' ? 'Cut blocked; text was not removed.' : error.action === 'paste' ? 'Paste blocked; text was not changed.' : 'Copy blocked; clipboard was not updated.';
	showEditorMessage(`${operation} Use the browser's Copy/Cut/Paste action or keyboard shortcut.`, constants.COLOR_STATUS_WARNING, 5);
}

/** Non-destructive commands only. Rejection is an explicit failure, not a cached success. */
export async function writeClipboard(clipboard: Clipboard, text: string, successMessage: string): Promise<boolean> {
	try {
		await clipboard.writeText(text);
	} catch (error) {
		if (!(error instanceof ClipboardAccessError)) throw error;
		reportClipboardFailure(error);
		return false;
	}
	showEditorMessage(successMessage, constants.COLOR_STATUS_SUCCESS, 1.5);
	return true;
}

/** Commands and non-browser shortcuts share permission failure feedback and admission. */
export function executeClipboardAction(clipboard: Clipboard, action: ClipboardAction, target: ClipboardTarget | undefined): void | Promise<void> {
	if (target?.[action] === undefined || action !== 'copy' && target.readOnly) return;
	if (action === 'paste') return pasteClipboard(clipboard, target);
	try { clipboard.execute(action, target); }
	catch (error) {
		if (!(error instanceof ClipboardAccessError)) throw error;
		reportClipboardFailure(error);
	}
}

async function pasteClipboard(clipboard: Clipboard, target: ClipboardTarget): Promise<void> {
	// Browser permission UI can outlive this control. Blur cancels the edit,
	// including switching documents that share a retained source-editor target.
	let cancelled = false;
	const unbind = inputFocus.target!.onDidBlur(() => { cancelled = true; });
	try {
		const contents = await clipboard.read();
		if (!cancelled && !target.readOnly) target.paste!(contents);
	} catch (error) {
		if (!(error instanceof ClipboardAccessError)) throw error;
		reportClipboardFailure(error);
	} finally { unbind(); }
}

/** Native browser gestures bypass polling; other hosts dispatch the same focused target. */
export function handleClipboardBindings(input: PlayerInput, clipboard: Clipboard, target: ClipboardTarget | undefined): boolean {
	if (target === undefined) return false;
	for (const code of CLIPBOARD_KEYS) {
		if (!isKeyJustPressed(code, input)) continue;
		const action = clipboardAction(code, isCtrlDown(input), isMetaDown(input), isShiftDown(input), isAltDown(input));
		if (action === undefined) continue;
		consumeIdeKey(code, input);
		void executeClipboardAction(clipboard, action, target);
		return true;
	}
	return false;
}

const CLIPBOARD_KEYS = ['KeyC', 'KeyX', 'KeyV', 'Insert', 'Delete'] as const;
