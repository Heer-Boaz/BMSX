import { point_in_rect } from '../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../hosts/common/input/text';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyDown } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { WorkbenchSlider } from './slider';

/** Captured range input, following Slider drag/value signals rather than scrollbar semantics. */
export class WorkbenchSliderControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	private input: WorkbenchSlider | undefined;
	private revision = 0;
	private generation = 0;
	private dragging = false;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService, parent: InputFocusTarget,
		private readonly changed: (value: number) => void, private readonly cancelled: () => void) {
		this.focusTarget = focus.createTarget(parent);
		this.focusTarget.canFocus = () => this.input !== undefined && this.input.interactive;
		this.focusTarget.commandContext = parent;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.cancelPointer());
	}
	public setInput(input: WorkbenchSlider): void {
		if (this.input === input) return;
		const generation = this.generation + 1;
		this.clearInput();
		if (this.generation === generation) { this.input = input; this.revision = input.revision; }
	}
	public clearInput(): void {
		const generation = ++this.generation;
		this.input = undefined; this.cancelPointer();
		if (this.generation === generation) this.focusTarget.release();
	}
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); this.unbindBlur(); }
	public update(): void {
		const input = this.input;
		if (input === undefined) return;
		if (input.revision !== this.revision || !input.interactive) {
			this.cancelPointer(); this.revision = input.revision;
			if (!input.interactive) this.focusTarget.release();
		}
	}
	public cancelPointer(): void {
		this.capture.release(this);
		if (this.dragging) { this.dragging = false; this.cancelled(); }
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		this.update();
		const input = this.input;
		if (input === undefined || !snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.bounds)) return false;
		if (input.interactive && (snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			const generation = this.generation, revision = input.revision, context = this.focusTarget.scope.contextGeneration;
			if (!this.focusTarget.focus() || this.generation !== generation || input.revision !== revision || !input.interactive
				|| this.focusTarget.scope.contextGeneration !== context || this.focus.admittedTarget !== this.focusTarget) return true;
			if (!this.capture.capture(this)) return true;
			this.dragging = true;
			this.change(input.valueAt(snapshot.viewportX), true);
			if (this.generation === generation && (snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		if (this.dragging) this.change(this.input!.valueAt(snapshot.viewportX), false);
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		const generation = this.generation;
		this.handleCapturedPointer(snapshot);
		if (this.generation === generation) { this.dragging = false; this.capture.release(this); }
	}
	private change(value: number, force: boolean): void {
		const input = this.input!;
		if (!force && value === input.value) return;
		input.value = value;
		this.changed(value);
	}
	private handleKeyboard(player: KeyInputEvent): void {
		const input = this.input!;
		if (!input.interactive) return;
		for (const key of KEYS) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player);
			this.change(key === 'Home' ? input.minimum : key === 'End' ? input.maximum
				: input.snap(input.value + (key === 'ArrowLeft' ? -input.step : input.step)), false);
			return;
		}
	}
}
const KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;
