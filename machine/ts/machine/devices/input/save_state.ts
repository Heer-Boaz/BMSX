import type { InputControllerRegisterState } from './registers';

export type InputControllerState = {
	sampleArmed: boolean;
	sampleSequence: number;
	lastSampleCycle: number;
	registers: InputControllerRegisterState;
};
