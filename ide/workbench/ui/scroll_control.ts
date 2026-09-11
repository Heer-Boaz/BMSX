import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { PointerButton } from '../../input/pointer/buttons';
import { WORKBENCH_POINTER_SCOPE, type PointerCaptureScope, type PointerCaptureService } from '../../input/pointer/capture';
import type { WorkbenchScrollViewport } from './scroll_viewport';
import { ScrollbarPointerControl } from './scrollbar_pointer';

/** Pane-owned gestures for a retained scroll view, independent of its child controls. */
export class WorkbenchScrollControl {
	public readonly focusTarget: InputFocusTarget;
	public lineStep = 0;
	private input: WorkbenchScrollViewport | null = null;
	private readonly pointer: ScrollbarPointerControl;
	private readonly unbindKeyboard: () => void;

	public constructor(focus: InputFocusService, capture: PointerCaptureService, parent: InputFocusTarget,
		keyboard?: (input: PlayerInput) => boolean, scope: PointerCaptureScope = WORKBENCH_POINTER_SCOPE) {
		this.pointer = new ScrollbarPointerControl(capture, scope);
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => {
			if (keyboard?.(input)) return;
			this.handleKeyboard(input);
		});
	}

	public setInput(input: WorkbenchScrollViewport): void {
		this.input = input;
		this.pointer.setInput(input.scrollbar);
	}

	public clearInput(): void {
		this.pointer.clearInput();
		this.focusTarget.release();
		this.input = null;
	}

	public dispose(): void { this.clearInput(); this.unbindKeyboard(); }

	public cancelPointer(): void {
		this.pointer.cancelPointer();
	}

	public update(): void {
		this.pointer.update();
	}

	/** Child hits run first. Background focus is distinct from non-focusing scrollbar capture. */
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const view = this.input!;
		if (this.pointer.handlePointer(snapshot)) return true;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.focusTarget.focus();
		return true;
	}

	public handleWheel(snapshot: PointerSnapshot, delta: number): boolean {
		const view = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport
			|| (!point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)
				&& !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.scrollbar.getTrack()))) return false;
		this.cancelPointer();
		view.scrollbar.setScroll(view.scrollTop + delta);
		return true;
	}

	private handleKeyboard(input: PlayerInput): void {
		const view = this.input!;
		for (const code of SCROLL_KEYS) {
			if (!shouldRepeatKeyFromPlayer(code, input)) continue;
			consumeIdeKey(code, input);
			this.cancelPointer();
			switch (code) {
				case 'ArrowUp': view.scrollbar.setScroll(view.scrollTop - this.lineStep); break;
				case 'ArrowDown': view.scrollbar.setScroll(view.scrollTop + this.lineStep); break;
				case 'PageUp': view.scrollbar.setScroll(view.scrollTop - view.height); break;
				case 'PageDown': view.scrollbar.setScroll(view.scrollTop + view.height); break;
				case 'Home': view.scrollbar.setScroll(0); break;
				case 'End': view.scrollbar.setScroll(view.contentHeight); break;
			}
			return;
		}
	}
}

const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
