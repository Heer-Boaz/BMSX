import type { InputControllerInputSource, InputControllerSnapshot } from '../../../machine/ts/machine/devices/input/contracts';
import type { Input } from './manager';
import { PointerInputContribution } from './pointer';

/** A session's physical input recipient, independent of the primary supervisor. */
export class InputChannel implements InputControllerInputSource {
	public readonly pointerContribution = new PointerInputContribution();
	public constructor(private readonly owner: Input) {
		owner.registerInputRecipient(this);
	}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		this.owner.writePhysicalSnapshot(snapshot, this);
	}
	public supervisorRequestLineHigh(): boolean { return false; }
	public applyInputControllerVibrationEffect(pad: number, durationMs: number, intensity: number): void {
		if (this.owner.guestInputRecipient === this) this.owner.applyPhysicalVibrationEffect(pad, durationMs, intensity);
	}
	public dispose(): void {
		this.owner.retireInputRecipient(this);
	}
}

export type InputRecipient = Input | InputChannel;
