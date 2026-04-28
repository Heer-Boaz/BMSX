import type { ActionState } from '../../input/models';

const ACTION_STATE_FLAG_PRESSED = 1 << 0;
const ACTION_STATE_FLAG_JUSTPRESSED = 1 << 1;
const ACTION_STATE_FLAG_JUSTRELEASED = 1 << 2;
const ACTION_STATE_FLAG_WASPRESSED = 1 << 3;
const ACTION_STATE_FLAG_WASRELEASED = 1 << 4;
const ACTION_STATE_FLAG_CONSUMED = 1 << 5;
const ACTION_STATE_FLAG_ALLJUSTPRESSED = 1 << 6;
const ACTION_STATE_FLAG_ALLWASPRESSED = 1 << 7;
const ACTION_STATE_FLAG_ALLJUSTRELEASED = 1 << 8;
const ACTION_STATE_FLAG_GUARDEDJUSTPRESSED = 1 << 9;
const ACTION_STATE_FLAG_REPEATPRESSED = 1 << 10;

export function packActionStateFlags(state: ActionState): number {
	let flags = 0;
	if (state.pressed) flags |= ACTION_STATE_FLAG_PRESSED;
	if (state.justpressed) flags |= ACTION_STATE_FLAG_JUSTPRESSED;
	if (state.justreleased) flags |= ACTION_STATE_FLAG_JUSTRELEASED;
	if (state.waspressed) flags |= ACTION_STATE_FLAG_WASPRESSED;
	if (state.wasreleased) flags |= ACTION_STATE_FLAG_WASRELEASED;
	if (state.consumed) flags |= ACTION_STATE_FLAG_CONSUMED;
	if (state.alljustpressed) flags |= ACTION_STATE_FLAG_ALLJUSTPRESSED;
	if (state.allwaspressed) flags |= ACTION_STATE_FLAG_ALLWASPRESSED;
	if (state.alljustreleased) flags |= ACTION_STATE_FLAG_ALLJUSTRELEASED;
	if (state.guardedjustpressed) flags |= ACTION_STATE_FLAG_GUARDEDJUSTPRESSED;
	if (state.repeatpressed) flags |= ACTION_STATE_FLAG_REPEATPRESSED;
	return flags;
}
