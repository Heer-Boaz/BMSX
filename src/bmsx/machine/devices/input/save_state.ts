import type { InputControllerPlayerState } from './action_table';
import type { InputControllerEventState } from './event_fifo';
import type { InputControllerRegisterState } from './registers';

export type InputControllerState = {
	sampleArmed: boolean;
	sampleSequence: number;
	lastSampleCycle: number;
	registers: InputControllerRegisterState;
	players: InputControllerPlayerState[];
	eventFifoEvents: InputControllerEventState[];
	eventFifoOverflow: boolean;
};
