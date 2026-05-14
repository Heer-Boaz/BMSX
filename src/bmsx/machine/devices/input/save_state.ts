import type { StringId } from '../../cpu/string_pool';

export type InputControllerActionState = {
	actionStringId: StringId;
	bindStringId: StringId;
	statusWord: number;
	valueQ16: number;
	pressTime: number;
	repeatCount: number;
};

export type InputControllerPlayerState = {
	actions: InputControllerActionState[];
};

export type InputControllerEventState = {
	player: number;
	actionStringId: StringId;
	statusWord: number;
	valueQ16: number;
	repeatCount: number;
};

export type InputControllerRegisterState = {
	player: number;
	actionStringId: StringId;
	bindStringId: StringId;
	ctrl: number;
	queryStringId: StringId;
	status: number;
	value: number;
	consumeStringId: StringId;
	outputIntensityQ16: number;
	outputDurationMs: number;
};

export type InputControllerState = {
	sampleArmed: boolean;
	sampleSequence: number;
	lastSampleCycle: number;
	registers: InputControllerRegisterState;
	players: InputControllerPlayerState[];
	eventFifoEvents: InputControllerEventState[];
	eventFifoOverflow: boolean;
};
