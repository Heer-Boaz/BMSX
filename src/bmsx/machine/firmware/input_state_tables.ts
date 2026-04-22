import type { ActionState, ButtonState } from '../../input/models';
import { Table } from '../cpu/cpu';
import type { Runtime } from '../runtime/runtime';
import type { StringValue } from '../memory/string_pool';

type ActionStateTableKeys = {
	action: StringValue;
	alljustpressed: StringValue;
	allwaspressed: StringValue;
	alljustreleased: StringValue;
	guardedjustpressed: StringValue;
	repeatpressed: StringValue;
	repeatcount: StringValue;
	pressed: StringValue;
	justpressed: StringValue;
	justreleased: StringValue;
	waspressed: StringValue;
	wasreleased: StringValue;
	consumed: StringValue;
	presstime: StringValue;
	timestamp: StringValue;
	pressedAtMs: StringValue;
	releasedAtMs: StringValue;
	pressId: StringValue;
	value: StringValue;
	value2d: StringValue;
	x: StringValue;
	y: StringValue;
};

type SharedInputStateFields = Pick<ButtonState,
	| 'pressed'
	| 'justpressed'
	| 'justreleased'
	| 'waspressed'
	| 'wasreleased'
	| 'repeatpressed'
	| 'repeatcount'
	| 'consumed'
	| 'presstime'
	| 'timestamp'
	| 'pressedAtMs'
	| 'releasedAtMs'
	| 'pressId'
	| 'value'
	| 'value2d'
>;

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

const actionStateKeysByRuntime = new WeakMap<Runtime, ActionStateTableKeys>();

function getActionStateTableKeys(runtime: Runtime): ActionStateTableKeys {
	const cached = actionStateKeysByRuntime.get(runtime);
	if (cached) {
		return cached;
	}
	const keys: ActionStateTableKeys = {
		action: runtime.luaKey('action'),
		alljustpressed: runtime.luaKey('alljustpressed'),
		allwaspressed: runtime.luaKey('allwaspressed'),
		alljustreleased: runtime.luaKey('alljustreleased'),
		guardedjustpressed: runtime.luaKey('guardedjustpressed'),
		repeatpressed: runtime.luaKey('repeatpressed'),
		repeatcount: runtime.luaKey('repeatcount'),
		pressed: runtime.luaKey('pressed'),
		justpressed: runtime.luaKey('justpressed'),
		justreleased: runtime.luaKey('justreleased'),
		waspressed: runtime.luaKey('waspressed'),
		wasreleased: runtime.luaKey('wasreleased'),
		consumed: runtime.luaKey('consumed'),
		presstime: runtime.luaKey('presstime'),
		timestamp: runtime.luaKey('timestamp'),
		pressedAtMs: runtime.luaKey('pressedAtMs'),
		releasedAtMs: runtime.luaKey('releasedAtMs'),
		pressId: runtime.luaKey('pressId'),
		value: runtime.luaKey('value'),
		value2d: runtime.luaKey('value2d'),
		x: runtime.luaKey('x'),
		y: runtime.luaKey('y'),
	};
	actionStateKeysByRuntime.set(runtime, keys);
	return keys;
}

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

function setSharedInputStateFields(table: Table, keys: ActionStateTableKeys, state: SharedInputStateFields): void {
	table.set(keys.pressed, state.pressed);
	table.set(keys.justpressed, state.justpressed);
	table.set(keys.justreleased, state.justreleased);
	table.set(keys.waspressed, state.waspressed);
	table.set(keys.wasreleased, state.wasreleased);
	table.set(keys.repeatpressed, state.repeatpressed);
	table.set(keys.repeatcount, state.repeatcount);
	table.set(keys.consumed, state.consumed);
	if (state.presstime !== null) {
		table.set(keys.presstime, state.presstime);
	}
	if (state.timestamp !== null) {
		table.set(keys.timestamp, state.timestamp);
	}
	if (state.pressedAtMs !== null) {
		table.set(keys.pressedAtMs, state.pressedAtMs);
	}
	if (state.releasedAtMs !== null) {
		table.set(keys.releasedAtMs, state.releasedAtMs);
	}
	if (state.pressId !== null) {
		table.set(keys.pressId, state.pressId);
	}
	if (state.value !== null) {
		table.set(keys.value, state.value);
	}
	if (state.value2d !== null) {
		const value2d = new Table(0, 2);
		value2d.set(keys.x, state.value2d[0]);
		value2d.set(keys.y, state.value2d[1]);
		table.set(keys.value2d, value2d);
	}
}

export function buildActionStateTable(runtime: Runtime, state: ActionState): Table {
	const keys = getActionStateTableKeys(runtime);
	const table = new Table(0, 18);
	table.set(keys.action, runtime.internString(state.action));
	table.set(keys.alljustpressed, state.alljustpressed);
	table.set(keys.allwaspressed, state.allwaspressed);
	table.set(keys.alljustreleased, state.alljustreleased);
	table.set(keys.guardedjustpressed, state.guardedjustpressed);
	setSharedInputStateFields(table, keys, state);
	return table;
}

export function buildButtonStateTable(runtime: Runtime, state: ButtonState): Table {
	const keys = getActionStateTableKeys(runtime);
	const table = new Table(0, 11);
	setSharedInputStateFields(table, keys, state);
	return table;
}
