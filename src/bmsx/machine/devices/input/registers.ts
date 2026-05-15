import type { StringId } from '../../cpu/string_pool';

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

export function createInputControllerRegisterState(): InputControllerRegisterState {
	return {
		player: 1,
		actionStringId: 0,
		bindStringId: 0,
		ctrl: 0,
		queryStringId: 0,
		status: 0,
		value: 0,
		consumeStringId: 0,
		outputIntensityQ16: 0,
		outputDurationMs: 0,
	};
}
