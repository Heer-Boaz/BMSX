import type { InputControllerPlayerState } from './action_table';
import type { InputControllerEventState } from './event_fifo';
import type { InputControllerRegisterState } from './registers';
import type { InputControllerSampleLatchState } from './sample_latch';

export type InputControllerState = InputControllerSampleLatchState & {
	registers: InputControllerRegisterState;
	players: InputControllerPlayerState[];
	eventFifoEvents: InputControllerEventState[];
	eventFifoOverflow: boolean;
};
