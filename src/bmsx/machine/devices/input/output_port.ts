import { Input } from '../../../input/manager';
import {
	decodeInputOutputIntensityQ16,
	INP_OUTPUT_STATUS_SUPPORTED,
} from './contracts';

export class InputControllerOutputPort {
	public constructor(private readonly input: Input) {}

	public readStatus(player: number): number {
		return this.input.getPlayerInput(player).supportsVibrationEffect ? INP_OUTPUT_STATUS_SUPPORTED : 0;
	}

	public apply(player: number, intensityQ16: number, durationMs: number): void {
		this.input.getPlayerInput(player).applyVibrationEffect({
			effect: 'dual-rumble',
			duration: durationMs,
			intensity: decodeInputOutputIntensityQ16(intensityQ16),
		});
	}
}
