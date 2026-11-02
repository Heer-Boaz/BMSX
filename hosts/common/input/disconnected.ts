import type { InputControllerInputSource } from '../../../machine/ts/machine/devices/input/contracts';
import { InputControllerPlayback } from './controller_playback';

const idle = new InputControllerPlayback();

/** A machine with no host input or output devices attached. */
export const DISCONNECTED_INPUT: InputControllerInputSource = {
	sampleInputControllerSnapshot: idle.writeInputControllerSnapshot.bind(idle),
	supervisorRequestLineHigh(): boolean { return false; },
	applyInputControllerVibrationEffect(): void {},
};
