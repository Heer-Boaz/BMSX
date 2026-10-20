import { KeyModifier } from '../../../../hosts/common/input/text';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import { COLOR_FOCUS_BORDER } from '../../../common/constants';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { GuestInputBinding } from '../../../input/focus';

/** Focus and input lifetime of one embedded scanout viewport. */
export class GameInputControl {
	public readonly focusTarget: InputFocusTarget;
	private readonly unbindKeyboard: () => void;
	private binding: GuestInputBinding | undefined;

	public constructor(parent: InputFocusTarget, private readonly recipient: InputRecipient) {
		this.focusTarget = inputFocus.createTarget(parent);
		this.focusTarget.canFocus = () => this.focusTarget.guestInput !== undefined;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => {
			if (player.modifiers === KeyModifier.shift && isKeyJustPressed('F1', player)) {
				consumeIdeKey('F1', player);
				this.focusTarget.release();
			}
		});
	}

	public setInput(bounds: Readonly<RectBounds>): void {
		if (this.binding === undefined) this.binding = { bounds, recipient: this.recipient };
		else this.binding.bounds = bounds;
		this.focusTarget.guestInput = this.binding;
	}

	public clearInput(): void {
		this.focusTarget.release();
		this.focusTarget.guestInput = undefined;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
	}

	/** The focus click belongs to the game too; do not consume its physical button. */
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const bounds = this.focusTarget.guestInput?.bounds;
		if (bounds === undefined || !snapshot.valid || !snapshot.insideViewport
			|| !point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.focusTarget.focus();
		return true;
	}

	public draw(): void {
		if (!this.focusTarget.hasFocus) return;
		const bounds = this.focusTarget.guestInput!.bounds;
		api.blit_rect(bounds.left - 1, bounds.top - 1, bounds.right, bounds.bottom, 0, COLOR_FOCUS_BORDER);
	}
}
