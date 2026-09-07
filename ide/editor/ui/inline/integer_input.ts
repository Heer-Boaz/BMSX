import type { Clipboard } from '../../../common/clipboard';
import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { InputEdit, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { resetBlink } from '../../render/caret';
import { TextField } from './text_field_model';
import { applyInlineFieldEditing, applyInlineFieldPointer, selectAll, setFieldText } from './text_field';
import { editorViewState } from '../view/state';

/** Decimal signed-word input; validation is at the human-text boundary. */
export function parseIntegerInput(text: string): number | null {
	// Unlike $, the end-of-input assertion does not admit a trailing newline.
	if (!/^[+-]?[0-9]+(?![\s\S])/.test(text)) return null;
	const value = Number(text);
	return value >= -0x80000000 && value <= 0x7fffffff ? value : null;
}

/** Godot-style value entry: local draft history, one accepted value change. */
export class IntegerInput implements InputEdit {
	public readonly field: TextField;
	public error = '';
	private valueText = '0';
	private readonly unbindKeyboard: () => void;
	private readonly pointer = {
		metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	};

	public constructor(
		parent: InputFocusTarget,
		private readonly clipboard: Clipboard,
		private readonly accept: (value: number) => void,
	) {
		this.field = new TextField(parent);
		this.field.focusTarget.edit = this;
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.field.focusTarget.onDidFocus(() => { selectAll(this.field); resetBlink(); });
		this.field.onDidChangeText(() => { this.error = ''; resetBlink(); });
		this.field.focusTarget.onDidBlur(() => {
			if (!this.commit()) {
				showEditorMessage('Invalid integer edit cancelled; source unchanged.', constants.COLOR_STATUS_WARNING, 4);
				this.cancel();
			}
		});
	}

	public get pending(): boolean { return this.field.text !== this.valueText; }

	public setValue(value: number): void {
		this.valueText = String(value);
		setFieldText(this.field, this.valueText, true);
		this.error = '';
	}

	public commit(): boolean {
		if (!this.pending) return true;
		const value = parseIntegerInput(this.field.text);
		if (value === null) {
			this.error = 'Enter a signed 32-bit integer';
			showEditorMessage(this.error, constants.COLOR_STATUS_WARNING, 4);
			return false;
		}
		this.accept(value);
		this.setValue(value);
		return true;
	}

	public cancel(): void {
		setFieldText(this.field, this.valueText, true);
		this.error = '';
	}

	public dispose(): void { this.unbindKeyboard(); }

	public handlePointer(textLeft: number, x: number, justPressed: boolean, pressed: boolean): void {
		if (justPressed && !this.field.focusTarget.hasFocus) {
			this.field.focusTarget.focus();
			return;
		}
		this.pointer.textLeft = textLeft;
		this.pointer.pointerX = x;
		this.pointer.justPressed = justPressed;
		this.pointer.pointerPressed = pressed;
		if (applyInlineFieldPointer(this.field, this.pointer).requestBlinkReset) resetBlink();
	}

	private handleKeyboard(input: PlayerInput): void {
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input);
			this.cancel();
			this.field.focusTarget.release();
		} else if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.commit()) this.field.focusTarget.release();
		} else {
			applyInlineFieldEditing(input, this.clipboard, this.field, INTEGER_INPUT_OPTIONS);
		}
	}
}

const INTEGER_INPUT_OPTIONS = { allowSpace: false, maxLength: 12 };
