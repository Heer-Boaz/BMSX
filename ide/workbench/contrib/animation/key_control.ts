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
import type { AnimationAuthoring } from './authoring';

type KeyGesture = { readonly kind: 'key'; readonly key: AnimationKeySource; readonly start: number; readonly originX: number; value: number;
	readonly originY: number; readonly field: 'value' | undefined; readonly startValue: number; fieldValue: number; readonly moveTime: boolean };
type TangentGesture = { readonly kind: 'tangent'; readonly key: AnimationKeySource; readonly field: 'arrive' | 'leave';
	readonly originX: number; readonly originY: number; readonly timeSpan: number; readonly startValue: number; fieldValue: number };
type PanGesture = { readonly kind: 'pan'; readonly originX: number; readonly minimum: number; readonly maximum: number };

const KEY_NAVIGATION = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;

/** A key gesture borrows exactly one source generation and commits only on physical release. */
export class AnimationKeyControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	private input: AnimationEditorInput | undefined;
	private gesture: KeyGesture | TangentGesture | PanGesture | undefined;
	private unbindSource: (() => void) | undefined;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public constructor(parent: InputFocusTarget,
		private readonly controller: Pick<AnimationEditorController, 'selectKey'>,
		private readonly authoring: Pick<AnimationAuthoring, 'canMoveKey' | 'moveKey' | 'canEditCurveField' | 'editCurveKey'>) {
		this.focusTarget = inputFocus.createTarget(parent);
		this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input?.keys.unit !== undefined;
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
		this.cancelPointer(); range.layout(left, top, right, bottom); this.input!.keys.revision++;
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const input = this.input!;
		const curve = input.keys.curve;
		const inCurve = curve.available && point_in_rect(snapshot.viewportX, snapshot.viewportY, curve.bounds);
		if (input.keys.unit === undefined || !snapshot.valid || !snapshot.insideViewport
			|| !inCurve && !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.keys.range.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0) {
			this.focusTarget.focus(); pointerCapture.capture(this, PointerButton.Auxiliary);
			this.gesture = { kind: 'pan', originX: snapshot.viewportX, minimum: input.keys.range.minimum, maximum: input.keys.range.maximum };
			return true;
		}
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			this.focusTarget.focus();
			if (input.keys.track === undefined) {
				input.keys.setCursor(input.keys.valueAt(snapshot.viewportX)); return true;
			}
			const handle = inCurve ? curve.handleAt(snapshot.viewportX, snapshot.viewportY) : undefined;
			const index = handle !== undefined ? input.keys.selected : inCurve ? curve.keyAt(input.keys, snapshot.viewportX, snapshot.viewportY) : input.keys.keyAt(snapshot.viewportX);
			this.controller.selectKey(input, index);
			if (index < 0) input.keys.setCursor(input.keys.valueAt(snapshot.viewportX));
			else {
				const key = input.keys.track.keys[index];
				const moveTime = handle === undefined && this.authoring.canMoveKey(input, key);
				const field = inCurve ? handle ?? 'value' : undefined;
				const editValue = field !== undefined && this.authoring.canEditCurveField(input, key, field);
				if (moveTime || editValue) {
					pointerCapture.capture(this);
					const startValue = editValue ? key[field]!.value! : 0;
					if (handle !== undefined) {
						const geometry = handle === 'arrive' ? curve.arriveHandle : curve.leaveHandle;
						const timeSpan = (geometry[2] - geometry[0]) * (input.keys.range.maximum - input.keys.range.minimum)
							/ (input.keys.range.bounds.right - input.keys.range.bounds.left - 6);
						this.gesture = { kind: 'tangent', key, field: handle, originX: snapshot.viewportX, originY: snapshot.viewportY,
							timeSpan, startValue, fieldValue: startValue };
					} else this.gesture = { kind: 'key', key, start: key.coordinate!.value!, value: key.coordinate!.value!, originX: snapshot.viewportX,
						originY: snapshot.viewportY, field: editValue ? 'value' : undefined, startValue, fieldValue: startValue, moveTime };
				}
			}
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const gesture = this.gesture!;
		const range = this.input!.keys.range, delta = snapshot.viewportX - gesture.originX;
		if (gesture.kind === 'pan') {
			const shift = delta * (gesture.maximum - gesture.minimum) / (range.bounds.right - range.bounds.left - 6);
			this.input!.keys.setView(gesture.minimum - shift, gesture.maximum - shift); return;
		}
		if (gesture.kind === 'tangent') {
			const vertical = snapshot.viewportY - gesture.originY, curve = this.input!.keys.curve;
			if (delta === 0 && vertical === 0) gesture.fieldValue = gesture.startValue;
			else {
				const unitsPerPixel = (range.maximum - range.minimum) / (range.bounds.right - range.bounds.left - 6);
				const horizontal = gesture.timeSpan / unitsPerPixel + delta;
				// The pointer stays on its native segment's side, with a one-pixel horizontal lever.
				const span = (gesture.field === 'arrive' ? Math.min(-1, horizontal) : Math.max(1, horizontal)) * unitsPerPixel;
				gesture.fieldValue = (gesture.startValue * gesture.timeSpan + curve.valueDelta(vertical)) / span;
			}
			curve.preview(gesture.field, gesture.fieldValue); return;
		}
		// Move from the grabbed key, not from an inverse-rounded pixel position.
		// Clicking a fractional key (or a wide native range) is not a source edit.
		if (gesture.moveTime) {
			gesture.value = gesture.start + delta * (range.maximum - range.minimum) / (range.bounds.right - range.bounds.left - 6);
			if (delta !== 0 && this.input!.keys.snap) gesture.value = Math.round(gesture.value / range.step) * range.step;
		}
		this.input!.keys.preview(gesture.value);
		if (gesture.field !== undefined) {
			const curve = this.input!.keys.curve;
			gesture.fieldValue = gesture.startValue + curve.valueDelta(snapshot.viewportY - gesture.originY);
			curve.preview(gesture.field, gesture.fieldValue);
		}
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const gesture = this.gesture!;
		this.cancelPointer();
		if (gesture.kind === 'pan') return;
		if (gesture.kind === 'tangent') {
			if (gesture.fieldValue !== gesture.startValue) this.authoring.editCurveKey(this.input!, gesture.key, undefined, gesture.field, gesture.fieldValue);
			return;
		}
		if (gesture.field !== undefined) {
			if (gesture.value !== gesture.start || gesture.fieldValue !== gesture.startValue) this.authoring.editCurveKey(this.input!, gesture.key,
				gesture.moveTime ? gesture.value : undefined, gesture.field, gesture.fieldValue);
		} else if (gesture.value !== gesture.start) this.authoring.moveKey(this.input!, gesture.key, gesture.value);
	}
	public cancelPointer(): void {
		pointerCapture.release(this); this.gesture = undefined;
		this.input?.keys.cancel();
	}
	private handleKeyboard(player: PlayerInput): void {
		const input = this.input!;
		if (isKeyJustPressed('Escape', player)) {
			consumeIdeKey('Escape', player); this.cancelPointer();
			if (input.keys.track !== undefined) this.controller.selectKey(input, -1);
			return;
		}
		if (isKeyJustPressed('Delete', player)) {
			consumeIdeKey('Delete', player); this.cancelPointer(); inputFocus.executeCommand('animation.remove', this.focusTarget); return;
		}
		for (const key of KEY_NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player);
			this.cancelPointer();
			if (input.keys.track === undefined) {
				input.keys.setCursor(key === 'Home' ? input.keys.extentMinimum : key === 'End' ? input.keys.extentMaximum
					: input.keys.cursor + (key === 'ArrowLeft' ? -input.keys.range.step : input.keys.range.step));
				input.keys.reveal(input.keys.cursor); return;
			}
			this.controller.selectKey(input, input.keys.adjacentKey(key)); return;
		}
	}
}
