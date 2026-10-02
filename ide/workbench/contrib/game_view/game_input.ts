import { KeyModifier } from '../../../../hosts/common/input/player';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import { COLOR_FOCUS_BORDER } from '../../../common/constants';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { api } from '../../../runtime/overlay_api';

/** Focus and input lifetime of one embedded scanout viewport. */
export class GameInputControl {
	public readonly focusTarget: InputFocusTarget;
	private readonly unbindKeyboard: () => void;

	public constructor(parent: InputFocusTarget) {
		this.focusTarget = inputFocus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => {
			if (player.getModifiers() === KeyModifier.shift && isKeyJustPressed('F1', player)) {
				consumeIdeKey('F1', player);
				this.focusTarget.release();
			}
		});
	}

	public setInput(bounds: Readonly<RectBounds>): void {
		this.focusTarget.guestInputBounds = bounds;
	}

	public clearInput(): void {
		this.focusTarget.release();
		this.focusTarget.guestInputBounds = undefined;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
	}

	/** The focus click belongs to the game too; do not consume its physical button. */
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const bounds = this.focusTarget.guestInputBounds;
		if (bounds === undefined || !snapshot.valid || !snapshot.insideViewport
			|| !point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.focusTarget.focus();
		return true;
	}

	public draw(): void {
		if (!this.focusTarget.hasFocus) return;
		const bounds = this.focusTarget.guestInputBounds!;
		api.blit_rect(bounds.left - 1, bounds.top - 1, bounds.right, bounds.bottom, 0, COLOR_FOCUS_BORDER);
	}
}
