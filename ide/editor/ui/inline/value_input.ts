import type { Clipboard } from '../../../common/clipboard';
import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { InlineInputOptions } from '../../../common/models';
import type { InputEdit, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { resetBlink } from '../../render/caret';
import { TextField } from './text_field_model';
import { applyInlineFieldEditing, applyInlineFieldPointer, selectAll, setFieldText } from './text_field';
import { SingleLineFieldViewport } from './single_line_viewport';
import { editorViewState } from '../view/state';

export type ValueInputResult<Value> = { readonly value: Value } | { readonly error: string };
export type ValueInputFormat<Value> = {
	readonly options: InlineInputOptions;
	readonly invalidBlurMessage: string;
	format(value: Value): string;
	parse(text: string): ValueInputResult<Value>;
};

/** A typed line edit: local draft history, one accepted value change. */
export class ValueInput<Value> implements InputEdit {
	public readonly field: TextField;
	public readonly viewport = new SingleLineFieldViewport();
	public error = '';
	private valueText = '';
	private readonly unbindKeyboard: () => void;
	private readonly pointer = {
		metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	};

	public constructor(parent: InputFocusTarget, private readonly clipboard: Clipboard,
		private readonly format: ValueInputFormat<Value>, private readonly accept: (value: Value) => void) {
		this.field = new TextField(parent);
		this.field.focusTarget.edit = this;
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.field.focusTarget.onDidFocus(() => { selectAll(this.field); resetBlink(); });
		this.field.onDidChangeText(() => { this.error = ''; resetBlink(); });
		this.field.focusTarget.onDidBlur(() => {
			if (!this.commit()) {
				showEditorMessage(this.format.invalidBlurMessage, constants.COLOR_STATUS_WARNING, 4);
				this.cancel();
			}
		});
	}

	public get pending(): boolean { return this.field.text !== this.valueText; }

	public setValue(value: Value): void {
		this.valueText = this.format.format(value);
		setFieldText(this.field, this.valueText, true);
		this.error = '';
	}

	public commit(): boolean {
		if (!this.pending) return true;
		const result = this.format.parse(this.field.text);
		if ('error' in result) {
			this.error = result.error;
			showEditorMessage(this.error, constants.COLOR_STATUS_WARNING, 4);
			return false;
		}
		// Acceptance may invalidate/detach the control. Its resulting blur must
		// not publish the same value again.
		this.setValue(result.value);
		this.accept(result.value);
		return true;
	}

	public cancel(): void {
		setFieldText(this.field, this.valueText, true);
		this.error = '';
	}

	public dispose(): void { this.unbindKeyboard(); }

	public layout(width: number): void {
		this.viewport.update(this.field, width - 6, editorViewState.inlineFieldMetricsRef, editorViewState.font.renderFont());
	}

	public handlePointer(textLeft: number, x: number, justPressed: boolean, pressed: boolean): void {
		if (justPressed && !this.field.focusTarget.hasFocus) {
			this.field.focusTarget.focus();
			return;
		}
		this.pointer.textLeft = textLeft - this.viewport.offset;
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
		} else if (isKeyJustPressed('Enter', input) || isKeyJustPressed('NumpadEnter', input)) {
			consumeIdeKey('Enter', input); consumeIdeKey('NumpadEnter', input);
			if (this.commit()) this.field.focusTarget.release();
		} else {
			applyInlineFieldEditing(input, this.clipboard, this.field, this.format.options);
		}
	}
}
