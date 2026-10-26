import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { InlineInputOptions } from '../../../common/models';
import type { InputEdit, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { resetInlineBlink } from '../../render/caret';
import { TextField } from './text_field_model';
import { applyInlineFieldEditing, applyInlineFieldPointer, selectAll, setFieldText } from './text_field';
import { SingleLineFieldViewport } from './single_line_viewport';
import { editorViewState } from '../view/state';
import type { RectBounds } from '../../../../machine/ts/common/rect';

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

	public constructor(parent: InputFocusTarget,
		private readonly format: ValueInputFormat<Value>, private readonly accept: (value: Value) => void,
		private readonly beforeCommit?: () => void) {
		this.field = new TextField(parent, format.options);
		this.field.focusTarget.edit = this;
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.field.focusTarget.onDidFocus(() => { selectAll(this.field); resetInlineBlink(); });
		this.field.onDidChangeText(() => { this.error = ''; resetInlineBlink(); });
		this.field.focusTarget.onDidBlur(() => {
			if (!this.commit()) {
				showEditorMessage(this.format.invalidBlurMessage, 'warning', 4);
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
		// A source-backed control can rebind or revoke its target before parsing
		// and publishing a draft, even when commit precedes the next paint/update.
		this.beforeCommit?.();
		if (!this.pending) return true;
		const result = this.format.parse(this.field.text);
		if ('error' in result) {
			this.error = result.error;
			showEditorMessage(this.error, 'warning', 4);
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

	public layout(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds> = bounds): void {
		this.viewport.layout(this.field, bounds, editorViewState.inlineFieldMetricsRef, editorViewState.font, clip);
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
		if (applyInlineFieldPointer(this.field, this.pointer).requestBlinkReset) resetInlineBlink();
	}

	private handleKeyboard(input: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input);
			this.cancel();
			this.field.focusTarget.release();
		} else if (isKeyJustPressed('Enter', input) || isKeyJustPressed('NumpadEnter', input)) {
			consumeIdeKey('Enter', input); consumeIdeKey('NumpadEnter', input);
			if (this.commit()) this.field.focusTarget.release();
		} else {
			applyInlineFieldEditing(input, this.field);
		}
	}
}
