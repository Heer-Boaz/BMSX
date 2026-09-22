import { InputControllerPlayback } from '../../hosts/common/input/controller_playback';
import type { InputControllerInputSource, InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';

/** Case-owned input, sampled by the normal ICU. Physical Studio input never enters it. */
export class TestInput implements InputControllerInputSource {
	public readonly playback = new InputControllerPlayback();
	public samples = 0;
	private releaseSample = 0;
	private releaseCode = '';
	private releasePad: number | null = null;

	public key(code: string, down: boolean, pad: number | null): number {
		if (pad === null) this.playback.setKeyboardKey(code, down);
		else this.playback.setGamepadButton(pad - 1, code, down);
		return this.samples + 1;
	}

	public press(code: string, samples: number, pad: number | null): number {
		this.key(code, true, pad);
		this.releaseCode = code;
		this.releasePad = pad;
		this.releaseSample = this.samples + samples + 1;
		return this.releaseSample;
	}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		this.samples += 1;
		if (this.samples === this.releaseSample) {
			this.key(this.releaseCode, false, this.releasePad);
			this.releaseSample = 0;
		}
		this.playback.writeInputControllerSnapshot(snapshot);
	}

	public supervisorRequestLineHigh(): boolean { return false; }
	public applyInputControllerVibrationEffect(): void {}

	public reset(): void {
		this.playback.reset();
		this.releaseSample = 0;
	}
}
