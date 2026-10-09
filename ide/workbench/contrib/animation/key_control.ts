import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { PointerButton } from '../../../input/pointer/buttons';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import type { AnimationEditorController } from './controller';
import type { AnimationEditorInput } from './editor_input';
import type { AnimationKeySource } from './model';

const KEY_NAVIGATION = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;

/** A key gesture borrows exactly one source generation and commits only on physical release. */
export class AnimationKeyControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	private input: AnimationEditorInput | undefined;
	private gesture: { readonly key: AnimationKeySource; readonly start: number; readonly originX: number; value: number } | undefined;
	private unbindSource: (() => void) | undefined;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public constructor(parent: InputFocusTarget,
		private readonly controller: Pick<AnimationEditorController, 'selectKey' | 'canMoveKey' | 'moveKey'>) {
		this.focusTarget = inputFocus.createTarget(parent);
		this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input?.keys.track !== undefined;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => this.handleKeyboard(player));
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.cancelPointer());
	}
	public setInput(input: AnimationEditorInput): void {
		this.clearInput(); this.input = input;
		this.unbindSource = input.onDidInvalidateProjection(() => this.cancelPointer());
	}
	public clearInput(): void {
		this.cancelPointer(); this.unbindSource?.(); this.unbindSource = undefined;
		this.focusTarget.release(); this.input = undefined;
	}
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); this.unbindBlur(); }
	public layout(left: number, top: number, right: number, bottom: number): void {
		const range = this.input!.keys.range;
		const bounds = range.bounds;
		if (bounds.left === left && bounds.top === top && bounds.right === right && bounds.bottom === bottom) return;
		this.cancelPointer(); range.layout(left, top, right, bottom);
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const input = this.input!;
		if (input.keys.track === undefined || !snapshot.valid || !snapshot.insideViewport
			|| !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.keys.range.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			this.focusTarget.focus();
			const index = input.keys.keyAt(snapshot.viewportX);
			this.controller.selectKey(input, index);
			if (index < 0) input.keys.setCursor(input.keys.range.valueAt(snapshot.viewportX));
			else {
				const key = input.keys.track.keys[index];
				if (this.controller.canMoveKey(input, key)) {
					pointerCapture.capture(this);
					this.gesture = { key, start: key.coordinate!.value!, value: key.coordinate!.value!, originX: snapshot.viewportX };
				}
			}
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const gesture = this.gesture!;
		const range = this.input!.keys.range, delta = snapshot.viewportX - gesture.originX;
		// Move from the grabbed key, not from an inverse-rounded pixel position.
		// Clicking a fractional key (or a wide native range) is not a source edit.
		gesture.value = delta === 0 ? gesture.start : range.snap(gesture.start
			+ delta * (range.maximum - range.minimum) / (range.bounds.right - range.bounds.left - 6));
		this.input!.keys.preview(gesture.value);
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const gesture = this.gesture!;
		this.cancelPointer();
		if (gesture.value !== gesture.start) this.controller.moveKey(this.input!, gesture.key, gesture.value);
	}
	public cancelPointer(): void {
		pointerCapture.release(this); this.gesture = undefined;
		this.input?.keys.cancel();
	}
	private handleKeyboard(player: PlayerInput): void {
		const input = this.input!;
		if (isKeyJustPressed('Escape', player)) {
			consumeIdeKey('Escape', player); this.cancelPointer(); this.controller.selectKey(input, -1); return;
		}
		if (isKeyJustPressed('Delete', player)) {
			consumeIdeKey('Delete', player); this.cancelPointer(); inputFocus.executeCommand('animation.remove', this.focusTarget); return;
		}
		for (const key of KEY_NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player);
			this.controller.selectKey(input, input.keys.adjacentKey(key)); return;
		}
	}
}
