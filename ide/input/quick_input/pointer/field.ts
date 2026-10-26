import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { pointerCapture, type PointerCaptureTarget } from '../../pointer/capture';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import { applyInlineFieldPointer } from '../../../editor/ui/inline/text_field';
import { resetInlineBlink } from '../../../editor/render/caret';
import type { TextField } from '../../../editor/ui/inline/text_field_model';
import type { InlineBarFieldLayout } from '../../../workbench/contrib/code_editor/inline_bar/field';

/** A field owns the complete selection gesture, including motion outside its bar. */
export class InlineBarFieldPointer implements PointerCaptureTarget {
	private readonly options;
	private readonly unbindCancel: () => void;

	public constructor(private readonly code: CodeEditorControl, private readonly field: TextField, private readonly layout: InlineBarFieldLayout) {
		this.options = { metrics: code.inlineFieldMetrics, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS };
		this.unbindCancel = field.focusTarget.onDidCancelInput(() => this.cancelPointer());
	}

	public dispose(): void { this.cancelPointer(); this.unbindCancel(); }

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean): void {
		this.move(snapshot, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
		if (justPressed && this.field.pointerSelecting) pointerCapture.capture(this, undefined, this.code.focusTarget.scope.surfaceScope);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void { this.move(snapshot, false, true); }
	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void { pointerCapture.cancelTarget(this); this.field.pointerSelecting = false; }

	private move(snapshot: PointerSnapshot, justPressed: boolean, pressed: boolean): void {
		const layout = this.layout;
		if (!layout.visible) return;
		layout.viewport.updateNativeCaret(this.field);
		this.options.metrics = this.code.inlineFieldMetrics;
		this.options.textLeft = layout.bounds.left + 3 - layout.viewport.offset;
		this.options.pointerX = snapshot.viewportX; this.options.justPressed = justPressed; this.options.pointerPressed = pressed;
		if (applyInlineFieldPointer(this.field, this.options).requestBlinkReset) resetInlineBlink();
	}
}
