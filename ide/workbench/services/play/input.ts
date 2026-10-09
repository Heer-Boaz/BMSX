import type { InputChannel } from '../../../../hosts/common/input/channel';
import type { InputControllerInputSource, InputControllerSnapshot } from '../../../../machine/ts/machine/devices/input/contracts';
import { TestInput } from '../../../testing/input';

/** The session selects scripted admission/cleanup or physical play, never a merged snapshot. */
export class PlayInput implements InputControllerInputSource {
	public readonly fixture = new TestInput();
	public interactive = false;

	public constructor(public readonly physical: InputChannel) {}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		if (this.interactive) this.physical.sampleInputControllerSnapshot(snapshot);
		else this.fixture.sampleInputControllerSnapshot(snapshot);
	}
	public supervisorRequestLineHigh(): boolean { return false; }
	public applyInputControllerVibrationEffect(pad: number, durationMs: number, intensity: number): void {
		if (this.interactive) this.physical.applyInputControllerVibrationEffect(pad, durationMs, intensity);
	}
	public dispose(): void {
		this.fixture.reset();
		this.physical.dispose();
	}
}
