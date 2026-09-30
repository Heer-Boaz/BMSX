import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { PointerButton } from '../../input/pointer/buttons';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import type { WorkbenchSplitView } from './split_view';

/** One captured sash gesture, with equivalent focused keyboard resizing. */
export class WorkbenchSplitControl implements PointerCaptureTarget, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	public hovered = false;
	private input: WorkbenchSplitView | undefined;
	private pointerOffset = 0;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly hover: PointerHoverService, parent: InputFocusTarget) {
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => this.handleKeyboard(player));
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.cancelPointer());
	}
	public setInput(input: WorkbenchSplitView): void { this.clearInput(); this.input = input; }
	public clearInput(): void { this.cancelPointer(); this.hover.release(this); this.focusTarget.release(); this.input = undefined; }
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); this.unbindBlur(); }
	public onPointerLeave(): void { this.hovered = false; }
	public cancelPointer(): void { this.capture.release(this); }
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const input = this.input;
		if (input === undefined || !snapshot.valid || !snapshot.insideViewport || Math.abs(snapshot.viewportX - input.position) > 4
			|| snapshot.viewportY < input.bounds.top || snapshot.viewportY >= input.bounds.bottom) return false;
		this.hover.visit(this); this.hovered = true;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			this.focusTarget.focus(); this.pointerOffset = snapshot.viewportX - input.position;
			this.capture.capture(this);
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void { this.input!.moveTo(snapshot.viewportX - this.pointerOffset); }
	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.capture.release(this); }
	private handleKeyboard(player: PlayerInput): void {
		for (const key of KEYS) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player);
			const input = this.input!;
			input.resize(key === 'Home' ? input.defaultRatio : input.ratio + (key === 'ArrowLeft' ? -0.05 : 0.05));
			return;
		}
	}
}
const KEYS = ['ArrowLeft', 'ArrowRight', 'Home'] as const;
