import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { pointerCapture, type PointerCaptureTarget } from '../../pointer/capture';
import { editorViewState } from '../../../editor/ui/view/state';
import { applyInlineFieldPointer } from '../../../editor/ui/inline/text_field';
import { resetBlink } from '../../../editor/render/caret';
import type { TextField } from '../../../editor/ui/inline/text_field_model';
import type { InlineBarFieldLayout } from '../../../workbench/contrib/code_editor/inline_bar/field';

/** A field owns the complete selection gesture, including motion outside its bar. */
export class InlineBarFieldPointer implements PointerCaptureTarget {
	private readonly options = { metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS };

	public constructor(private readonly field: TextField, private readonly getLayout: () => InlineBarFieldLayout) {
		field.focusTarget.onDidCancelInput(() => this.cancelPointer());
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean): void {
		this.move(snapshot, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
		if (justPressed && this.field.pointerSelecting) pointerCapture.capture(this);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void { this.move(snapshot, false, true); }
	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void { pointerCapture.cancelTarget(this); this.field.pointerSelecting = false; }

	private move(snapshot: PointerSnapshot, justPressed: boolean, pressed: boolean): void {
		const layout = this.getLayout();
		this.options.metrics = editorViewState.inlineFieldMetricsRef;
		this.options.textLeft = layout.bounds.left + 3 - layout.viewport.offset;
		this.options.pointerX = snapshot.viewportX; this.options.justPressed = justPressed; this.options.pointerPressed = pressed;
		if (applyInlineFieldPointer(this.field, this.options).requestBlinkReset) resetBlink();
	}
}
