import { KeyModifier } from '../../../../hosts/common/input/text';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import { COLOR_FOCUS_BORDER } from '../../../common/constants';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { InputInteraction } from '../../../input/interaction';
import type { RuntimeTransport } from '../../../runtime/transport';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import { pointerCapture } from '../../../input/pointer/capture';
import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { GuestInputBinding, GuestInputPresentation } from '../../../input/focus';

/** Focus and input lifetime of one embedded scanout viewport. */
export class GameInputControl {
	public readonly focusTarget: InputFocusTarget;
	private readonly unbindKeyboard: () => void;
	private readonly unbindFocus: () => void;
	public readonly interaction: InputInteraction;
	private binding: GuestInputBinding | undefined;

	public constructor(parent: InputFocusTarget, private readonly recipient: InputRecipient,
		private readonly presentation: GuestInputPresentation, transport: RuntimeTransport) {
		const scope = new InputFocusScope(parent.scope.surfaceScope, parent.scope);
		this.interaction = new InputInteraction(transport);
		scope.interaction = this.interaction;
		this.focusTarget = inputFocus.createTarget(parent, scope);
		this.focusTarget.canFocus = () => this.focusTarget.guestInput !== undefined;
		this.unbindFocus = this.focusTarget.onDidFocus(() => { this.interaction.running = true; });
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => {
			if (player.modifiers === KeyModifier.shift && isKeyJustPressed('F1', player)) {
				consumeIdeKey('F1', player);
				if (this.binding !== undefined) pointerCapture.cancelGuest(this.binding);
				this.focusTarget.release();
			}
		});
	}

	public setInput(bounds: Readonly<RectBounds>): void {
		if (this.binding === undefined) this.binding = { bounds, recipient: this.recipient, presentation: this.presentation };
		else this.binding.bounds = bounds;
		this.focusTarget.scope.interaction = this.interaction;
		this.focusTarget.guestInput = this.binding;
	}

	public clearInput(): void {
		if (this.binding !== undefined) pointerCapture.cancelGuest(this.binding);
		this.interaction.running = false;
		this.focusTarget.guestInput = undefined;
		this.focusTarget.scope.interaction = undefined;
		this.focusTarget.scope.retireContext();
		this.focusTarget.release();
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindFocus();
	}

	/** The focus click belongs to the game too; do not consume its physical button. */
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const bounds = this.focusTarget.guestInput?.bounds;
		if (bounds === undefined || !snapshot.valid || !snapshot.insideViewport
			|| !point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			this.interaction.running = true;
			this.focusTarget.focus();
		}
		return true;
	}

	public draw(): void {
		if (!this.focusTarget.hasFocus) return;
		const bounds = this.focusTarget.guestInput!.bounds;
		api.blit_rect(bounds.left - 1, bounds.top - 1, bounds.right, bounds.bottom, 0, COLOR_FOCUS_BORDER);
	}
}
