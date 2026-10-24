import { clipboardAction, ClipboardAccessError, type Clipboard, type ClipboardAction, type ClipboardTarget } from '../../hosts/common/clipboard';
import type { KeyInputEvent } from '../../hosts/common/input/text';
import { showEditorMessage } from '../common/feedback_state';
import type { InputFocusTarget } from './focus';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './keyboard/key_input';

export function reportClipboardFailure(error: ClipboardAccessError): void {
	const operation = error.action === 'cut' ? 'Cut blocked; text was not removed.' : error.action === 'paste' ? 'Paste blocked; text was not changed.' : 'Copy blocked; clipboard was not updated.';
	showEditorMessage(`${operation} Use the browser's Copy/Cut/Paste action or keyboard shortcut.`, 'warning', 5);
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
	showEditorMessage(successMessage, 'success', 1.5);
	return true;
}

/** Commands and non-browser shortcuts share permission failure feedback and admission. */
export function executeClipboardAction(clipboard: Clipboard, action: ClipboardAction, owner: InputFocusTarget | null): void | Promise<void> {
	const target = owner?.clipboard;
	if (target?.[action] === undefined || action !== 'copy' && target.readOnly) return;
	if (action === 'paste') return pasteClipboard(clipboard, target, owner!);
	try { clipboard.execute(action, target); }
	catch (error) {
		if (!(error instanceof ClipboardAccessError)) throw error;
		reportClipboardFailure(error);
	}
}

async function pasteClipboard(clipboard: Clipboard, target: ClipboardTarget, owner: InputFocusTarget): Promise<void> {
	// Browser permission UI can outlive input ownership, including a host modal
	// that preserves focus or documents sharing a retained source-editor target.
	let cancelled = false;
	const unbind = owner.onDidCancelInput(() => { cancelled = true; });
	try {
		const contents = await clipboard.read();
		if (!cancelled && !target.readOnly) target.paste!(contents);
	} catch (error) {
		if (!(error instanceof ClipboardAccessError)) throw error;
		reportClipboardFailure(error);
	} finally { unbind(); }
}

/** Native browser gestures bypass polling; other hosts dispatch the same focused target. */
export function handleClipboardBindings(input: KeyInputEvent, clipboard: Clipboard, owner: InputFocusTarget | null): boolean {
	if (owner?.clipboard === undefined) return false;
	for (const code of CLIPBOARD_KEYS) {
		if (!isKeyJustPressed(code, input)) continue;
		const action = clipboardAction(code, isCtrlDown(input), isMetaDown(input), isShiftDown(input), isAltDown(input));
		if (action === undefined) continue;
		consumeIdeKey(code, input);
		void executeClipboardAction(clipboard, action, owner);
		return true;
	}
	return false;
}

const CLIPBOARD_KEYS = ['KeyC', 'KeyX', 'KeyV', 'Insert', 'Delete'] as const;
