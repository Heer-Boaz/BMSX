import { ActionDefinitionEvaluator } from '../../../input/action_parser';
import { Input } from '../../../input/manager';
import type { ActionState, BGamepadButton, GamepadBinding, GamepadInputMapping, KeyboardBinding, KeyboardInputMapping } from '../../../input/models';
import type { StringId, StringPool } from '../../cpu/string_pool';
import { InputControllerEventFifo } from './event_fifo';
import {
	INP_EVENT_ACTION_STATUS_MASK,
	INP_STATUS_CONSUMED,
	INPUT_CONTROLLER_PLAYER_COUNT,
	createInputActionSnapshot,
	encodeInputActionValueQ16,
	packInputActionStatus,
} from './contracts';

const INP_CONTEXT_ID = 'inp_chip';

type InputControllerPlayerSlot = {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	actions: InputControllerActionState[];
	contextPushed: boolean;
};

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

export type InputControllerQueryResult = {
	statusWord: number;
	valueQ16: number;
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

function createPlayerSlots(): InputControllerPlayerSlot[] {
	const states = new Array<InputControllerPlayerSlot>(INPUT_CONTROLLER_PLAYER_COUNT);
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

export class InputControllerActionTable {
	private readonly playerStates = createPlayerSlots();

	public constructor(
		private readonly input: Input,
		private readonly strings: StringPool,
	) {}

	public reset(): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			this.clearPlayerActions(playerIndex, this.playerStates[playerIndex - 1]!);
		}
	}

	public capturePlayers(): InputControllerPlayerState[] {
		return this.playerStates.map(state => ({
			actions: state.actions.map(action => ({ ...action })),
		}));
	}

	public restorePlayers(players: readonly InputControllerPlayerState[]): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			this.clearPlayerActions(playerIndex, this.playerStates[playerIndex - 1]!);
		}
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const restoredPlayer = players[playerIndex - 1]!;
			this.restorePlayerActions(playerIndex, this.playerStates[playerIndex - 1]!, restoredPlayer.actions);
		}
	}

	public commitAction(playerIndex: number, actionStringId: StringId, bindStringId: StringId): void {
		const state = this.playerStates[playerIndex - 1]!;
		this.installActionMapping(state, actionStringId, bindStringId);
		this.upsertAction(state, actionStringId, bindStringId);
		const playerInput = this.input.getPlayerInput(playerIndex);
		playerInput.pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
		state.contextPushed = true;
	}

	public resetActions(playerIndex: number): void {
		this.clearPlayerActions(playerIndex, this.playerStates[playerIndex - 1]!);
	}

	public sampleCommittedActions(eventFifo: InputControllerEventFifo): void {
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
					eventFifo.push(playerIndex, action.actionStringId, action.statusWord, action.valueQ16, action.repeatCount);
				}
			}
		}
	}

	public queryAction(playerIndex: number, queryText: string, out: InputControllerQueryResult): void {
		const state = this.playerStates[playerIndex - 1]!;
		const triggered = ActionDefinitionEvaluator.checkActionTriggered(
			queryText,
			(actionName) => this.createSnapshotActionState(state, actionName),
		);
		if (!triggered) {
			out.statusWord = 0;
			out.valueQ16 = 0;
			return;
		}
		const selectedAction = this.selectQuerySnapshotAction(state, queryText);
		out.statusWord = selectedAction.statusWord;
		out.valueQ16 = selectedAction.valueQ16;
	}

	public consumeActions(playerIndex: number, actionNames: string): void {
		const playerInput = this.input.getPlayerInput(playerIndex);
		const state = this.playerStates[playerIndex - 1]!;
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

	private clearPlayerActions(playerIndex: number, state: InputControllerPlayerSlot): void {
		if (state.contextPushed) {
			this.input.getPlayerInput(playerIndex).clearContext(INP_CONTEXT_ID);
		}
		state.keyboard = {};
		state.gamepad = {};
		state.actions = [];
		state.contextPushed = false;
	}

	private restorePlayerActions(playerIndex: number, state: InputControllerPlayerSlot, actions: readonly InputControllerActionState[]): void {
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

	private installActionMapping(state: InputControllerPlayerSlot, actionStringId: StringId, bindStringId: StringId): void {
		const actionName = this.strings.toString(actionStringId);
		const bindingsText = this.strings.toString(bindStringId);
		const keyboardBindings: KeyboardBinding[] = [];
		const gamepadBindings: GamepadBinding[] = [];
		this.appendBindings(bindingsText, keyboardBindings, gamepadBindings);
		state.keyboard[actionName] = keyboardBindings;
		state.gamepad[actionName] = gamepadBindings;
	}

	private upsertAction(state: InputControllerPlayerSlot, actionStringId: StringId, bindStringId: StringId): void {
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

	private createSnapshotActionState(state: InputControllerPlayerSlot, actionName: string): ActionState {
		const action = this.findSnapshotAction(state, actionName);
		return createInputActionSnapshot(actionName, action.statusWord, action.valueQ16, action.pressTime, action.repeatCount);
	}

	private selectQuerySnapshotAction(state: InputControllerPlayerSlot, queryText: string): InputControllerActionState {
		const actionName = ActionDefinitionEvaluator.getSimpleActionName(queryText);
		if (actionName === undefined) {
			return COMPLEX_QUERY_ACTION_SNAPSHOT;
		}
		return this.findSnapshotAction(state, actionName);
	}

	private findSnapshotAction(state: InputControllerPlayerSlot, actionName: string): InputControllerActionState {
		for (let index = 0; index < state.actions.length; index += 1) {
			const action = state.actions[index]!;
			if (this.strings.toString(action.actionStringId) === actionName) {
				return action;
			}
		}
		return EMPTY_ACTION_SNAPSHOT;
	}

	private markSnapshotActionConsumed(state: InputControllerPlayerSlot, actionName: string): void {
		for (let index = 0; index < state.actions.length; index += 1) {
			const action = state.actions[index]!;
			if (this.strings.toString(action.actionStringId) === actionName) {
				action.statusWord = (action.statusWord | INP_STATUS_CONSUMED) >>> 0;
				return;
			}
		}
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
			} else {
				keyboardBindings.push(binding);
			}
			gamepadBindings.push({ id: binding });
			bindingStart = index + 1;
		}
	}
}
