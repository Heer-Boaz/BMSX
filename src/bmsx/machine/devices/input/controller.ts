import { Input } from '../../../input/manager';
import type { BGamepadButton, GamepadBinding, GamepadInputMapping, KeyboardBinding, KeyboardInputMapping } from '../../../input/models';
import {
	INP_CTRL_COMMIT,
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { asStringId, StringValue, type Value } from '../../cpu/cpu';
import type { StringId, StringPool } from '../../cpu/string_pool';

const INP_CONTEXT_ID = 'inp_chip';
export const INPUT_CONTROLLER_PLAYER_COUNT = Input.PLAYERS_MAX;

type InputControllerActionState = {
	actionStringId: StringId;
	bindStringId: StringId;
};

type InputControllerPlayerState = {
	actions: InputControllerActionState[];
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

export type InputControllerState = {
	sampleArmed: boolean;
	registers: InputControllerRegisterState;
	players: InputControllerPlayerState[];
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

export class InputController {
	private readonly playerStates = createPlayerChipStates();
	private registers = createResetRegisters();
	private sampleArmed = false;

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
	}

	public reset(): void {
		this.sampleArmed = false;
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const state = this.playerStates[playerIndex - 1]!;
			this.clearPlayerActions(playerIndex, state);
		}
		this.registers = createResetRegisters();
		this.mirrorRegisters();
	}

	public cancelArmedSample(): void {
		this.sampleArmed = false;
	}

	public onVblankEdge(): void {
		if (!this.sampleArmed) {
			return;
		}
		this.input.beginFrame();
		this.sampleArmed = false;
	}

	public captureState(): InputControllerState {
		return {
			sampleArmed: this.sampleArmed,
			registers: { ...this.registers },
			players: this.playerStates.map(state => ({
				actions: state.actions.map(action => ({ ...action })),
			})),
		};
	}

	public restoreState(state: InputControllerState): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			this.clearPlayerActions(playerIndex, this.playerStates[playerIndex - 1]!);
		}
		this.sampleArmed = state.sampleArmed;
		this.registers = { ...state.registers };
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const restoredPlayer = state.players[playerIndex - 1]!;
			this.restorePlayerActions(playerIndex, this.playerStates[playerIndex - 1]!, restoredPlayer.actions);
		}
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

	private queryAction(): void {
		const playerInput = this.input.getPlayerInput(this.registers.player);
		const triggered = playerInput.checkActionTriggered(this.strings.toString(this.registers.queryStringId));
		this.writeResult(triggered ? 1 : 0, 0);
	}

	private consumeActions(): void {
		const actionNames = this.strings.toString(this.registers.consumeStringId);
		const playerInput = this.input.getPlayerInput(this.registers.player);
		let actionStart = 0;
		for (let index = 0; index <= actionNames.length; index += 1) {
			if (index !== actionNames.length && actionNames.charCodeAt(index) !== 44) {
				continue;
			}
			playerInput.consumeAction(actionNames.slice(actionStart, index));
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
				return;
			}
		}
		state.actions.push({ actionStringId, bindStringId });
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
