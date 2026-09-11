import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { PointerButton } from '../../input/pointer/buttons';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { WorkbenchScrollViewport } from './scroll_viewport';

/** Pane-owned gestures for a retained scroll view, independent of its child controls. */
export class WorkbenchScrollControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public lineStep = 0;
	private input: WorkbenchScrollViewport | null = null;
	private revision = 0;
	private dragging = false;
	private pointerOffset = 0;
	private readonly unbindKeyboard: () => void;

	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService, parent: InputFocusTarget,
		keyboard?: (input: PlayerInput) => boolean) {
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => {
			if (keyboard?.(input)) return;
			this.handleKeyboard(input);
		});
	}

	public setInput(input: WorkbenchScrollViewport): void {
		this.cancelPointer();
		this.input = input;
		this.revision = input.revision;
	}

	public clearInput(): void {
		this.cancelPointer();
		this.focusTarget.release();
		this.input = null;
	}

	public dispose(): void { this.clearInput(); this.unbindKeyboard(); }

	public cancelPointer(): void {
		this.capture.release(this);
		this.dragging = false;
	}

	public update(): void {
		if (this.input !== null && this.revision !== this.input.revision) {
			this.cancelPointer();
			this.revision = this.input.revision;
		}
	}

	/** Child hits run first. Background focus is distinct from non-focusing scrollbar capture. */
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const view = this.input!;
		this.update();
		const content = point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds);
		const track = point_in_rect(snapshot.viewportX, snapshot.viewportY, view.scrollbar.getTrack());
		if (!snapshot.valid || !snapshot.insideViewport || (!content && !track)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			if (content) this.focusTarget.focus();
			else if (view.scrollbar.isVisible()) {
				this.pointerOffset = view.scrollbar.beginDrag(snapshot.viewportY);
				this.capture.capture(this);
				this.dragging = true;
				if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
			}
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		if (this.dragging) this.input!.scrollbar.drag(snapshot.viewportY, this.pointerOffset);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		this.cancelPointer();
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
