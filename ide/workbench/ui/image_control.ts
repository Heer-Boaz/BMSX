import { point_in_rect } from '../../../machine/ts/common/rect';
import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyDown } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { WORKBENCH_POINTER_SCOPE, type PointerCaptureScope, type PointerCaptureService, type PointerCaptureTarget } from '../../input/pointer/capture';
import type { WorkbenchImageViewport } from './image_viewport';
import { ScrollbarPointerControl } from './scrollbar_pointer';

/** Pane-owned image gestures; decoded pixels and retained viewport geometry belong to the input. */
export class WorkbenchImageControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	private input: WorkbenchImageViewport | null = null;
	private readonly scrollbar: ScrollbarPointerControl;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	private unbindHorizontal: (() => void) | undefined;
	private unbindVertical: (() => void) | undefined;
	private anchorX = 0;
	private anchorY = 0;
	private anchorScrollX = 0;
	private anchorScrollY = 0;

	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService,
		parent: InputFocusTarget, private readonly scope: PointerCaptureScope = WORKBENCH_POINTER_SCOPE) {
		this.scrollbar = new ScrollbarPointerControl(capture, scope);
		this.focusTarget = focus.createTarget(parent);
		this.focusTarget.canFocus = () => this.input !== null;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindBlur = this.focusTarget.onDidBlur(this.cancelPointer);
	}

	public setInput(input: WorkbenchImageViewport): void {
		this.cancelPointer();
		this.input = input;
	}

	public clearInput(): void {
		this.cancelPointer();
		this.focusTarget.release();
		this.input = null;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindBlur();
	}

	public readonly cancelPointer = (): void => {
		this.capture.release(this);
		this.scrollbar.cancelPointer();
		this.unbindHorizontal?.();
		this.unbindVertical?.();
		this.unbindHorizontal = undefined;
		this.unbindVertical = undefined;
	};

	public handlePointer(snapshot: PointerSnapshot): boolean {
		const view = this.input!;
		if (this.scrollbar.handlePointer(snapshot, view.horizontal) || this.scrollbar.handlePointer(snapshot, view.vertical)) return true;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) return false;
		const pressed = snapshot.justPressedButtons;
		if ((pressed & (PointerButton.Primary | PointerButton.Auxiliary)) !== 0) {
			this.focusTarget.focus();
			const button = (pressed & PointerButton.Auxiliary) !== 0 ? PointerButton.Auxiliary : PointerButton.Primary;
			this.capture.capture(this, button, this.scope);
			this.anchorX = snapshot.viewportX;
			this.anchorY = snapshot.viewportY;
			this.anchorScrollX = view.horizontal.getScroll();
			this.anchorScrollY = view.vertical.getScroll();
			this.unbindHorizontal = view.horizontal.onDidChangeTrack(this.cancelPointer);
			this.unbindVertical = view.vertical.onDidChangeTrack(this.cancelPointer);
			if ((snapshot.justReleasedButtons & button) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const view = this.input!;
		view.horizontal.setScroll(this.anchorScrollX - snapshot.viewportX + this.anchorX);
		view.vertical.setScroll(this.anchorScrollY - snapshot.viewportY + this.anchorY);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		this.cancelPointer();
	}

	public handleWheel(snapshot: PointerSnapshot, delta: number, zoomSteps: number, modifiers: KeyModifier): boolean {
		const view = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport
			|| (!point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)
				&& !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.horizontal.getTrack())
				&& !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.vertical.getTrack()))) return false;
		this.cancelPointer();
		if ((modifiers & (KeyModifier.ctrl | KeyModifier.meta)) !== 0) view.zoomBySteps(zoomSteps, snapshot.viewportX, snapshot.viewportY);
		else if ((modifiers & KeyModifier.shift) !== 0) view.pan(delta, 0);
		else view.pan(0, delta);
		return true;
	}

	private handleKeyboard(input: KeyInputEvent): void {
		const view = this.input!;
		for (const code of IMAGE_KEYS) {
			if (!isKeyDown(code, input)) continue;
			consumeIdeKey(code, input);
			this.cancelPointer();
			switch (code) {
				case 'ArrowLeft': view.pan(-16, 0); break;
				case 'ArrowRight': view.pan(16, 0); break;
				case 'ArrowUp': view.pan(0, -16); break;
				case 'ArrowDown': view.pan(0, 16); break;
				case 'PageUp': view.pan(0, view.bounds.top - view.bounds.bottom); break;
				case 'PageDown': view.pan(0, view.bounds.bottom - view.bounds.top); break;
				case 'Home': view.horizontal.setScroll(0); view.vertical.setScroll(0); break;
				case 'End': view.horizontal.setScroll(view.horizontal.getMaximumScroll()); view.vertical.setScroll(view.vertical.getMaximumScroll()); break;
				case 'Equal': case 'NumpadAdd': view.zoomBySteps(1); break;
				case 'Minus': case 'NumpadSubtract': view.zoomBySteps(-1); break;
			}
			return;
		}
	}
}

const IMAGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'] as const;
