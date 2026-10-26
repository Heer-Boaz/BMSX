import { showEditorMessage } from '../../../../common/feedback_state';
import { TextField } from '../../../../editor/ui/inline/text_field_model';
import { setFieldText } from '../../../../editor/ui/inline/text_field';
import { beginNavigationCapture, completeNavigation } from '../../../../navigation/navigation_history';
import { setCursorPosition } from '../../../../editor/ui/view/caret/caret';
import { breakUndoSequence } from '../../../../editor/editing/undo_controller';
import * as TextEditing from '../../../../editor/editing/text_editing_and_selection';
import type { CodeEditorControl } from '../../../../editor/ui/code_editor_control';
import { resetBlinkState } from '../../../../editor/ui/view/caret/blink';
import { resetInlineBlink } from '../../../../editor/render/caret';
import { InlineBarFieldLayout } from '../inline_bar/field';
import { InlineBarFieldPointer } from '../../../../input/quick_input/pointer/field';
import { handleLineJumpInput } from '../../../../input/quick_input/line_jump/input';
import type { LineJumpState } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import * as constants from '../../../../common/constants';

/** A line-jump draft belongs to this Source control, never its resource model. */
export class CodeEditorLineJump {
	private readonly layoutListeners = new Set<() => void>();
	public onDidChangeLayout(listener: () => void): () => void {
		this.layoutListeners.add(listener);
		return () => this.layoutListeners.delete(listener);
	}
	private emitLayoutChanged(): void { for (const listener of this.layoutListeners) listener(); }

	public readonly state: LineJumpState;
	public readonly fieldLayout: InlineBarFieldLayout;
	public readonly fieldPointer: InlineBarFieldPointer;
	private readonly unbindKeyboard: () => void;
	private readonly unbindChange: () => void;

	public constructor(public readonly code: CodeEditorControl) {
		const field = new TextField(code.focusTarget, { allowSpace: false, singleLine: true,
			characterFilter: value => value >= '0' && value <= '9', maxLength: 6 });
		this.state = { field, visible: false, value: '' };
		this.fieldLayout = new InlineBarFieldLayout(code, field);
		this.fieldPointer = new InlineBarFieldPointer(code, field, this.fieldLayout);
		field.focusTarget.canFocus = () => this.state.visible && this.fieldLayout.visible;
		this.unbindKeyboard = field.focusTarget.bindKeyboard(input => handleLineJumpInput(input, this));
		this.unbindChange = field.onDidChangeText(() => {
			this.state.value = field.text;
			resetInlineBlink();
		});
	}

	public open(): void {
		this.applyFieldText('', true);
		const wasVisible = this.state.visible;
		this.state.visible = true;
		if (!wasVisible) this.emitLayoutChanged();
		resetInlineBlink();
	}

	public focus(): void { this.state.field.focusTarget.focus(); }

	public close(clearValue: boolean): void {
		const wasVisible = this.state.visible;
		this.state.visible = false;
		if (wasVisible) this.emitLayoutChanged();
		this.fieldLayout.hide();
		if (clearValue) this.applyFieldText('', true);
		this.state.field.selectionAnchor = null;
		this.state.field.pointerSelecting = false;
	}

	public focusEditor(): void { this.close(false); }

	public clearInput(): void { this.close(false); }

	public dispose(): void {
		this.unbindChange(); this.unbindKeyboard();
		this.close(true);
		this.fieldPointer.dispose(); this.layoutListeners.clear();
	}

	public layoutField(bounds: Readonly<RectBounds>): void {
		this.fieldLayout.layout(bounds, 'LINE', '', constants.LINE_JUMP_BAR_MARGIN_Y);
	}

	public apply(): void {
		if (this.state.value.length === 0) {
			showEditorMessage('Enter a line number', 'warning', 1.5);
			return;
		}
		const target = Number.parseInt(this.state.value, 10);
		const lineCount = this.code.model.buffer.getLineCount();
		if (target < 1 || target > lineCount) {
			showEditorMessage(`Line must be between 1 and ${lineCount}`, 'warning', 1.8);
			return;
		}
		const checkpoint = beginNavigationCapture();
		setCursorPosition(this.code, target - 1, 0);
		TextEditing.clearSelection(this.code);
		breakUndoSequence(this.code);
		this.close(true);
		resetBlinkState(this.code.caret);
		showEditorMessage(`Jumped to line ${target}`, 'success', 1.5);
		completeNavigation(checkpoint);
	}

	public applyFieldText(value: string, moveCursorToEnd: boolean): void {
		this.state.value = value;
		setFieldText(this.state.field, value, moveCursorToEnd);
	}
}
