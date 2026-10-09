import type { InputControllerInputSource, InputControllerSnapshot } from '../../../machine/ts/machine/devices/input/contracts';
import type { Input } from './manager';

/** A session's physical input recipient, independent of the primary supervisor. */
export class InputChannel implements InputControllerInputSource {
	public constructor(private readonly owner: Input) {}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		this.owner.writePhysicalSnapshot(snapshot, this.owner.guestInputRecipient !== this);
	}
	public supervisorRequestLineHigh(): boolean { return false; }
	public applyInputControllerVibrationEffect(pad: number, durationMs: number, intensity: number): void {
		if (this.owner.guestInputRecipient === this) this.owner.applyPhysicalVibrationEffect(pad, durationMs, intensity);
	}
	public dispose(): void {
		if (this.owner.guestInputRecipient === this) this.owner.guestInputRecipient = null;
	}
}

export type InputRecipient = Input | InputChannel;
