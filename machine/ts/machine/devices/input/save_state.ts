import type { InputControllerRegisterState } from './registers';
import type { InputControllerSampleLatchState } from './sample_latch';

export type InputControllerState = InputControllerSampleLatchState & {
	registers: InputControllerRegisterState;
};
