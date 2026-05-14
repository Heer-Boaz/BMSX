import { Input } from '../../../input/manager';
import { ActionDefinitionEvaluator } from '../../../input/action_parser';
import type { BGamepadButton, GamepadBinding, GamepadInputMapping, KeyboardBinding, KeyboardInputMapping } from '../../../input/models';
import {
	INP_CTRL_COMMIT,
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_EVENT_ACTION,
	IO_INP_EVENT_COUNT,
	IO_INP_EVENT_CTRL,
	IO_INP_EVENT_FLAGS,
	IO_INP_EVENT_PLAYER,
	IO_INP_EVENT_REPEAT_COUNT,
	IO_INP_EVENT_STATUS,
	IO_INP_EVENT_VALUE,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { asStringId, StringValue, type Value } from '../../cpu/cpu';
import type { StringId, StringPool } from '../../cpu/string_pool';
import {
	createInputActionSnapshot,
	encodeInputActionValueQ16,
	INP_EVENT_ACTION_STATUS_MASK,
	INP_EVENT_CTRL_CLEAR,
	INP_EVENT_CTRL_POP,
	INP_EVENT_STATUS_EMPTY,
	INP_EVENT_STATUS_FULL,
	INP_EVENT_STATUS_OVERFLOW,
	INP_STATUS_CONSUMED,
	INPUT_CONTROLLER_EVENT_FIFO_CAPACITY,
	packInputActionStatus,
} from './contracts';

const INP_CONTEXT_ID = 'inp_chip';
export const INPUT_CONTROLLER_PLAYER_COUNT = Input.PLAYERS_MAX;

type InputControllerActionState = {
	actionStringId: StringId;
	bindStringId: StringId;
	statusWord: number;
	valueQ16: number;
	pressTime: number;
	repeatCount: number;
};

type InputControllerPlayerState = {
	actions: InputControllerActionState[];
};

type InputControllerEventState = {
	player: number;
	actionStringId: StringId;
	statusWord: number;
	valueQ16: number;
	repeatCount: number;
};

type InputControllerRegisterState = {
	player: number;
	actionStringId: StringId;
	bindStringId: StringId;
	ctrl: number;
	queryStringId: StringId;
	status: number;
	value: number;
	consumeStringId: StringId;
};

type PlayerChipState = {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	actions: InputControllerActionState[];
	contextPushed: boolean;
};

const EMPTY_ACTION_SNAPSHOT: InputControllerActionState = {
	actionStringId: 0,
	bindStringId: 0,
	statusWord: 0,
	valueQ16: 0,
	pressTime: 0,
	repeatCount: 0,
};
const COMPLEX_QUERY_ACTION_SNAPSHOT: InputControllerActionState = {
	actionStringId: 0,
	bindStringId: 0,
	statusWord: 1,
	valueQ16: 0,
	pressTime: 0,
	repeatCount: 0,
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

function createResetRegisters(): InputControllerRegisterState {
	return {
		player: 1,
		actionStringId: 0,
		bindStringId: 0,
		ctrl: 0,
		queryStringId: 0,
		status: 0,
		value: 0,
		consumeStringId: 0,
	};
}

function createPlayerChipStates(): PlayerChipState[] {
	const states = new Array<PlayerChipState>(INPUT_CONTROLLER_PLAYER_COUNT);
	for (let index = 0; index < states.length; index += 1) {
		states[index] = {
			keyboard: {},
			gamepad: {},
			actions: [],
			contextPushed: false,
		};
	}
	return states;
}

function createEventFifoSlots(): InputControllerEventState[] {
	const slots = new Array<InputControllerEventState>(INPUT_CONTROLLER_EVENT_FIFO_CAPACITY);
	for (let index = 0; index < slots.length; index += 1) {
		slots[index] = {
			player: 0,
			actionStringId: 0,
			statusWord: 0,
			valueQ16: 0,
			repeatCount: 0,
		};
	}
	return slots;
}

export class InputController {
	private readonly playerStates = createPlayerChipStates();
	private readonly eventFifo = createEventFifoSlots();
	private registers = createResetRegisters();
	private sampleArmed = false;
	private sampleSequence = 0;
	private lastSampleCycle = 0;
	private eventFifoReadIndex = 0;
	private eventFifoWriteIndex = 0;
	private eventFifoCount = 0;
	private eventFifoOverflow = false;

	public constructor(
		private readonly memory: Memory,
		private readonly input: Input,
		private readonly strings: StringPool,
	) {
		this.memory.mapIoWrite(IO_INP_PLAYER, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_ACTION, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_BIND, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_CTRL, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_QUERY, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_CONSUME, this.onRegisterWrite.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_STATUS, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_COUNT, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_PLAYER, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_ACTION, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_FLAGS, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_VALUE, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_REPEAT_COUNT, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_CTRL, this.onEventRegisterRead.bind(this));
		this.memory.mapIoWrite(IO_INP_EVENT_CTRL, this.onEventCtrlWrite.bind(this));
	}

	public reset(): void {
		this.sampleArmed = false;
		this.sampleSequence = 0;
		this.lastSampleCycle = 0;
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const state = this.playerStates[playerIndex - 1]!;
			this.clearPlayerActions(playerIndex, state);
		}
		this.registers = createResetRegisters();
		this.clearEventFifo();
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
		this.mirrorRegisters();
	}

	public cancelArmedSample(): void {
		this.sampleArmed = false;
	}

	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		if (!this.sampleArmed) {
			return;
		}
		this.sampleSequence = (this.sampleSequence + 1) >>> 0;
		this.lastSampleCycle = nowCycles >>> 0;
		this.input.samplePlayers(currentTimeMs);
		this.sampleCommittedActions();
		this.sampleArmed = false;
	}

	public captureState(): InputControllerState {
		return {
			sampleArmed: this.sampleArmed,
			sampleSequence: this.sampleSequence,
			lastSampleCycle: this.lastSampleCycle,
			registers: { ...this.registers },
			players: this.playerStates.map(state => ({
				actions: state.actions.map(action => ({ ...action })),
			})),
			eventFifoEvents: this.captureEventFifoEvents(),
			eventFifoOverflow: this.eventFifoOverflow,
		};
	}

	public restoreState(state: InputControllerState): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			this.clearPlayerActions(playerIndex, this.playerStates[playerIndex - 1]!);
		}
		this.sampleArmed = state.sampleArmed;
		this.sampleSequence = state.sampleSequence;
		this.lastSampleCycle = state.lastSampleCycle;
		this.registers = { ...state.registers };
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const restoredPlayer = state.players[playerIndex - 1]!;
			this.restorePlayerActions(playerIndex, this.playerStates[playerIndex - 1]!, restoredPlayer.actions);
		}
		this.restoreEventFifo(state.eventFifoEvents);
		this.eventFifoOverflow = state.eventFifoOverflow;
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
		this.mirrorRegisters();
	}

	private onRegisterWrite(addr: number, value: Value): void {
		switch (addr) {
			case IO_INP_PLAYER:
				this.registers.player = (value as number) >>> 0;
				return;
			case IO_INP_ACTION:
				this.registers.actionStringId = asStringId(value as StringValue);
				return;
			case IO_INP_BIND:
				this.registers.bindStringId = asStringId(value as StringValue);
				return;
			case IO_INP_CTRL:
				this.onCtrlWrite((value as number) >>> 0);
				return;
			case IO_INP_QUERY:
				this.registers.queryStringId = asStringId(value as StringValue);
				this.queryAction();
				return;
			case IO_INP_CONSUME:
				this.registers.consumeStringId = asStringId(value as StringValue);
				this.consumeActions();
				return;
		}
	}

	private onCtrlWrite(command: number): void {
		this.registers.ctrl = command;
		switch (command) {
			case INP_CTRL_COMMIT:
				this.commitAction();
				return;
			case INP_CTRL_ARM:
				this.sampleArmed = true;
				return;
			case INP_CTRL_RESET:
				this.resetActions();
				return;
		}
	}

	private onEventRegisterRead(addr: number): Value {
		switch (addr) {
			case IO_INP_EVENT_STATUS:
				return this.readEventFifoStatus();
			case IO_INP_EVENT_COUNT:
				return this.eventFifoCount;
			case IO_INP_EVENT_PLAYER:
				return this.readFrontEvent().player;
			case IO_INP_EVENT_ACTION:
				return StringValue.get(this.readFrontEvent().actionStringId);
			case IO_INP_EVENT_FLAGS:
				return this.readFrontEvent().statusWord;
			case IO_INP_EVENT_VALUE:
				return this.readFrontEvent().valueQ16;
			case IO_INP_EVENT_REPEAT_COUNT:
				return this.readFrontEvent().repeatCount;
			case IO_INP_EVENT_CTRL:
				return 0;
		}
		throw new Error(`ICU event register read is not mapped for ${addr >>> 0}.`);
	}

	private onEventCtrlWrite(_addr: number, value: Value): void {
		const command = (value as number) >>> 0;
		switch (command) {
			case INP_EVENT_CTRL_POP:
				this.popEventFifo();
				break;
			case INP_EVENT_CTRL_CLEAR:
				this.clearEventFifo();
				break;
		}
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
	}

	private queryAction(): void {
		const queryText = this.strings.toString(this.registers.queryStringId);
		const state = this.playerStates[this.registers.player - 1]!;
		const triggered = ActionDefinitionEvaluator.checkActionTriggered(
			queryText,
			(actionName) => this.createSnapshotActionState(state, actionName),
		);
		if (!triggered) {
			this.writeResult(0, 0);
			return;
		}
		const selectedAction = this.selectQuerySnapshotAction(state, queryText);
		this.writeResult(selectedAction.statusWord, selectedAction.valueQ16);
	}

	private consumeActions(): void {
		const actionNames = this.strings.toString(this.registers.consumeStringId);
		const playerInput = this.input.getPlayerInput(this.registers.player);
		const state = this.playerStates[this.registers.player - 1]!;
		let actionStart = 0;
		for (let index = 0; index <= actionNames.length; index += 1) {
			if (index !== actionNames.length && actionNames.charCodeAt(index) !== 44) {
				continue;
			}
			const actionName = actionNames.slice(actionStart, index);
			playerInput.consumeAction(actionName);
			this.markSnapshotActionConsumed(state, actionName);
			actionStart = index + 1;
		}
	}

	private commitAction(): void {
		const playerIndex = this.registers.player;
		const state = this.playerStates[playerIndex - 1]!;
		this.installActionMapping(state, this.registers.actionStringId, this.registers.bindStringId);
		this.upsertAction(state, this.registers.actionStringId, this.registers.bindStringId);
		const playerInput = this.input.getPlayerInput(playerIndex);
		playerInput.pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
		state.contextPushed = true;
	}

	private resetActions(): void {
		const playerIndex = this.registers.player;
		const state = this.playerStates[playerIndex - 1]!;
		this.clearPlayerActions(playerIndex, state);
		this.writeResult(0, 0);
	}

	private clearPlayerActions(playerIndex: number, state: PlayerChipState): void {
		if (state.contextPushed) {
			this.input.getPlayerInput(playerIndex).clearContext(INP_CONTEXT_ID);
		}
		state.keyboard = {};
		state.gamepad = {};
		state.actions = [];
		state.contextPushed = false;
	}

	private restorePlayerActions(playerIndex: number, state: PlayerChipState, actions: readonly InputControllerActionState[]): void {
		for (let index = 0; index < actions.length; index += 1) {
			const action = actions[index]!;
			this.installActionMapping(state, action.actionStringId, action.bindStringId);
			state.actions.push({ ...action });
		}
		if (state.actions.length > 0) {
			this.input.getPlayerInput(playerIndex).pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
			state.contextPushed = true;
		}
	}

	private installActionMapping(state: PlayerChipState, actionStringId: StringId, bindStringId: StringId): void {
		const actionName = this.strings.toString(actionStringId);
		const bindingsText = this.strings.toString(bindStringId);
		const keyboardBindings: KeyboardBinding[] = [];
		const gamepadBindings: GamepadBinding[] = [];
		this.appendBindings(bindingsText, keyboardBindings, gamepadBindings);
		state.keyboard[actionName] = keyboardBindings;
		state.gamepad[actionName] = gamepadBindings;
	}

	private upsertAction(state: PlayerChipState, actionStringId: StringId, bindStringId: StringId): void {
		for (let index = 0; index < state.actions.length; index += 1) {
			const action = state.actions[index]!;
			if (action.actionStringId === actionStringId) {
				action.bindStringId = bindStringId;
				action.statusWord = 0;
				action.valueQ16 = 0;
				action.pressTime = 0;
				action.repeatCount = 0;
				return;
			}
		}
		state.actions.push({ actionStringId, bindStringId, statusWord: 0, valueQ16: 0, pressTime: 0, repeatCount: 0 });
	}

	private sampleCommittedActions(): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const state = this.playerStates[playerIndex - 1]!;
			const playerInput = this.input.getPlayerInput(playerIndex);
			for (let actionIndex = 0; actionIndex < state.actions.length; actionIndex += 1) {
				const action = state.actions[actionIndex]!;
				const actionState = playerInput.getActionState(this.strings.toString(action.actionStringId));
				action.statusWord = packInputActionStatus(actionState);
				action.valueQ16 = encodeInputActionValueQ16(actionState);
				action.pressTime = actionState.presstime ?? 0;
				action.repeatCount = actionState.repeatcount >>> 0;
				if ((action.statusWord & INP_EVENT_ACTION_STATUS_MASK) !== 0) {
					this.pushEventFifo(playerIndex, action);
				}
			}
		}
	}

	private readEventFifoStatus(): number {
		return (this.eventFifoCount === 0 ? INP_EVENT_STATUS_EMPTY : 0)
			| (this.eventFifoCount === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY ? INP_EVENT_STATUS_FULL : 0)
			| (this.eventFifoOverflow ? INP_EVENT_STATUS_OVERFLOW : 0);
	}

	private readFrontEvent(): InputControllerEventState {
		if (this.eventFifoCount === 0) {
			return this.eventFifo[0]!;
		}
		return this.eventFifo[this.eventFifoReadIndex]!;
	}

	private pushEventFifo(player: number, action: InputControllerActionState): void {
		if (this.eventFifoCount === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.eventFifoOverflow = true;
			return;
		}
		const slot = this.eventFifo[this.eventFifoWriteIndex]!;
		slot.player = player;
		slot.actionStringId = action.actionStringId;
		slot.statusWord = action.statusWord;
		slot.valueQ16 = action.valueQ16;
		slot.repeatCount = action.repeatCount;
		this.eventFifoWriteIndex += 1;
		if (this.eventFifoWriteIndex === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.eventFifoWriteIndex = 0;
		}
		this.eventFifoCount += 1;
	}

	private popEventFifo(): void {
		if (this.eventFifoCount === 0) {
			return;
		}
		const slot = this.eventFifo[this.eventFifoReadIndex]!;
		slot.player = 0;
		slot.actionStringId = 0;
		slot.statusWord = 0;
		slot.valueQ16 = 0;
		slot.repeatCount = 0;
		this.eventFifoReadIndex += 1;
		if (this.eventFifoReadIndex === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.eventFifoReadIndex = 0;
		}
		this.eventFifoCount -= 1;
	}

	private clearEventFifo(): void {
		for (let index = 0; index < this.eventFifo.length; index += 1) {
			const slot = this.eventFifo[index]!;
			slot.player = 0;
			slot.actionStringId = 0;
			slot.statusWord = 0;
			slot.valueQ16 = 0;
			slot.repeatCount = 0;
		}
		this.eventFifoReadIndex = 0;
		this.eventFifoWriteIndex = 0;
		this.eventFifoCount = 0;
		this.eventFifoOverflow = false;
	}

	private captureEventFifoEvents(): InputControllerEventState[] {
		const events = new Array<InputControllerEventState>(this.eventFifoCount);
		let entry = this.eventFifoReadIndex;
		for (let index = 0; index < events.length; index += 1) {
			const slot = this.eventFifo[entry]!;
			events[index] = {
				player: slot.player,
				actionStringId: slot.actionStringId,
				statusWord: slot.statusWord,
				valueQ16: slot.valueQ16,
				repeatCount: slot.repeatCount,
			};
			entry += 1;
			if (entry === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
				entry = 0;
			}
		}
		return events;
	}

	private restoreEventFifo(events: readonly InputControllerEventState[]): void {
		this.clearEventFifo();
		for (let index = 0; index < events.length; index += 1) {
			const event = events[index]!;
			const slot = this.eventFifo[this.eventFifoWriteIndex]!;
			slot.player = event.player;
			slot.actionStringId = event.actionStringId;
			slot.statusWord = event.statusWord;
			slot.valueQ16 = event.valueQ16;
			slot.repeatCount = event.repeatCount;
			this.eventFifoWriteIndex += 1;
			if (this.eventFifoWriteIndex === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
				this.eventFifoWriteIndex = 0;
			}
			this.eventFifoCount += 1;
		}
	}

	private createSnapshotActionState(state: PlayerChipState, actionName: string) {
		const action = this.findSnapshotAction(state, actionName);
		return createInputActionSnapshot(actionName, action.statusWord, action.valueQ16, action.pressTime, action.repeatCount);
	}

	private selectQuerySnapshotAction(state: PlayerChipState, queryText: string): InputControllerActionState {
		const actionName = ActionDefinitionEvaluator.getSimpleActionName(queryText);
		if (actionName === undefined) {
			return COMPLEX_QUERY_ACTION_SNAPSHOT;
		}
		return this.findSnapshotAction(state, actionName);
	}

	private findSnapshotAction(state: PlayerChipState, actionName: string): InputControllerActionState {
		for (let index = 0; index < state.actions.length; index += 1) {
			const action = state.actions[index]!;
			if (this.strings.toString(action.actionStringId) === actionName) {
				return action;
			}
		}
		return EMPTY_ACTION_SNAPSHOT;
	}

	private markSnapshotActionConsumed(state: PlayerChipState, actionName: string): void {
		for (let index = 0; index < state.actions.length; index += 1) {
			const action = state.actions[index]!;
			if (this.strings.toString(action.actionStringId) === actionName) {
				action.statusWord = (action.statusWord | INP_STATUS_CONSUMED) >>> 0;
				return;
			}
		}
	}

	private writeResult(status: number, value: number): void {
		this.registers.status = status;
		this.registers.value = value;
		this.memory.writeIoValue(IO_INP_STATUS, status);
		this.memory.writeIoValue(IO_INP_VALUE, value);
	}

	private mirrorRegisters(): void {
		this.memory.writeIoValue(IO_INP_PLAYER, this.registers.player);
		this.memory.writeIoValue(IO_INP_ACTION, StringValue.get(this.registers.actionStringId));
		this.memory.writeIoValue(IO_INP_BIND, StringValue.get(this.registers.bindStringId));
		this.memory.writeIoValue(IO_INP_CTRL, this.registers.ctrl);
		this.memory.writeIoValue(IO_INP_QUERY, StringValue.get(this.registers.queryStringId));
		this.memory.writeIoValue(IO_INP_STATUS, this.registers.status);
		this.memory.writeIoValue(IO_INP_VALUE, this.registers.value);
		this.memory.writeIoValue(IO_INP_CONSUME, StringValue.get(this.registers.consumeStringId));
	}

	private appendBindings(bindingsText: string, keyboardBindings: KeyboardBinding[], gamepadBindings: GamepadBinding[]): void {
		let bindingStart = 0;
		for (let index = 0; index <= bindingsText.length; index += 1) {
			if (index !== bindingsText.length && bindingsText.charCodeAt(index) !== 44) {
				continue;
			}
			const binding = bindingsText.slice(bindingStart, index) as BGamepadButton;
			const defaultKeyboardBindings = Input.DEFAULT_INPUT_MAPPING.keyboard[binding];
			if (defaultKeyboardBindings) {
				for (let bindingIndex = 0; bindingIndex < defaultKeyboardBindings.length; bindingIndex += 1) {
					keyboardBindings.push(defaultKeyboardBindings[bindingIndex]!);
				}
			}
			gamepadBindings.push({ id: binding });
			bindingStart = index + 1;
		}
	}
}
