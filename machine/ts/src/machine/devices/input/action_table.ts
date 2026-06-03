import { ActionDefinitionEvaluator } from '../../../input/action_parser';
import { Input, makeActionState } from '../../../input/manager';
import type { InputSource, PlayerInput } from '../../../input/player';
import { inputBindingId, type ActionState, type BGamepadButton, type ButtonId, type ButtonState } from '../../../input/models';
import type { StringId, StringPool } from '../../cpu/string_pool';
import { InputControllerEventFifo } from './event_fifo';
import {
	INP_EVENT_ACTION_STATUS_MASK,
	INP_STATUS_CONSUMED,
	INPUT_CONTROLLER_PLAYER_COUNT,
	encodeInputActionValueQ16,
	encodeInputActionValueXQ16,
	encodeInputActionValueYQ16,
	packInputActionStatus,
} from './contracts';

type InputControllerPlayerSlot = {
	bindings: InputControllerActionBinding[];
	actions: InputControllerActionState[];
	sampledButtons: InputControllerSampledButtonState[];
	sampledButtonCount: number;
};

export type InputControllerActionState = {
	actionStringId: StringId;
	bindStringId: StringId;
	statusWord: number;
	valueQ16: number;
	pressTime: number;
	repeatCount: number;
};

type InputControllerSampledButtonState = {
	source: InputSource;
	button: ButtonId;
	state: ButtonState;
};

type InputControllerActionBinding = {
	actionName: string;
	source: InputSource;
	button: ButtonId;
};

export type InputControllerPlayerState = {
	actions: InputControllerActionState[];
};

export type InputControllerQueryResult = {
	statusWord: number;
	valueQ16: number;
	valueXQ16: number;
	valueYQ16: number;
};

function createPlayerSlots(): InputControllerPlayerSlot[] {
	const states = new Array<InputControllerPlayerSlot>(INPUT_CONTROLLER_PLAYER_COUNT);
	for (let index = 0; index < states.length; index += 1) {
		states[index] = {
			bindings: [],
			actions: [],
			sampledButtons: [],
			sampledButtonCount: 0,
		};
	}
	return states;
}

export class InputControllerActionTable {
	private readonly playerStates = createPlayerSlots();

	public constructor(
		private readonly input: Input,
		private readonly strings: StringPool,
	) {
		this.reset();
	}

	public reset(): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			this.resetPlayerActions(this.playerStates[playerIndex - 1]!);
		}
	}

	public capturePlayers(): InputControllerPlayerState[] {
		return this.playerStates.map(state => ({
			actions: state.actions.map(action => ({ ...action })),
		}));
	}

	public restorePlayers(players: readonly InputControllerPlayerState[]): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			this.resetPlayerActions(this.playerStates[playerIndex - 1]!);
		}
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const restoredPlayer = players[playerIndex - 1]!;
			this.restorePlayerActions(this.playerStates[playerIndex - 1]!, restoredPlayer.actions);
		}
	}

	public commitAction(playerIndex: number, actionStringId: StringId, bindStringId: StringId): void {
		const state = this.playerStates[playerIndex - 1]!;
		this.installActionMapping(state, actionStringId, bindStringId);
		this.upsertAction(state, actionStringId, bindStringId);
	}

	public resetActions(playerIndex: number): void {
		this.resetPlayerActions(this.playerStates[playerIndex - 1]!);
	}

	public sampleButtons(eventFifo: InputControllerEventFifo): void {
		for (let playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
			const state = this.playerStates[playerIndex - 1]!;
			const playerInput = this.input.getPlayerInput(playerIndex);
			state.sampledButtonCount = 0;
			this.sampleLoadedBindings(playerInput, state);
			for (let actionIndex = 0; actionIndex < state.actions.length; actionIndex += 1) {
				const action = state.actions[actionIndex]!;
				const actionState = this.createSampledActionState(state, this.strings.toString(action.actionStringId));
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
		const simpleActionName = ActionDefinitionEvaluator.getSimpleActionName(queryText);
		let selectedState: ActionState | undefined;
		let selectedActionName = '';
		let selectedWindow: number | undefined;
		const readActionState = (actionName: string, windowMs?: number): ActionState => {
			if (selectedState === undefined || selectedActionName !== actionName || selectedWindow !== windowMs) {
				selectedState = this.createSampledActionState(state, actionName);
				selectedActionName = actionName;
				selectedWindow = windowMs;
			}
			return selectedState;
		};
		if (simpleActionName !== undefined) {
			const triggered = ActionDefinitionEvaluator.checkActionTriggered(queryText, readActionState);
			if (!triggered) {
				out.statusWord = 0;
				out.valueQ16 = 0;
				out.valueXQ16 = 0;
				out.valueYQ16 = 0;
				return;
			}
			const actionState = selectedState!;
			out.statusWord = packInputActionStatus(actionState);
			out.valueQ16 = encodeInputActionValueQ16(actionState);
			out.valueXQ16 = encodeInputActionValueXQ16(actionState);
			out.valueYQ16 = encodeInputActionValueYQ16(actionState);
			return;
		}
		const triggered = ActionDefinitionEvaluator.checkActionTriggered(queryText, readActionState);
		if (!triggered) {
			out.statusWord = 0;
			out.valueQ16 = 0;
			out.valueXQ16 = 0;
			out.valueYQ16 = 0;
			return;
		}
		out.statusWord = 1;
		out.valueQ16 = 0;
		out.valueXQ16 = 0;
		out.valueYQ16 = 0;
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
			this.consumeActionButtons(playerInput, state, actionName);
			this.markSnapshotActionConsumed(state, actionName);
			actionStart = index + 1;
		}
	}

	private resetPlayerActions(state: InputControllerPlayerSlot): void {
		state.bindings.length = 0;
		this.loadDefaultBindings(state);
		state.actions = [];
		state.sampledButtonCount = 0;
	}

	private restorePlayerActions(state: InputControllerPlayerSlot, actions: readonly InputControllerActionState[]): void {
		for (let index = 0; index < actions.length; index += 1) {
			const action = actions[index]!;
			this.installActionMapping(state, action.actionStringId, action.bindStringId);
			state.actions.push({ ...action });
		}
	}

	private installActionMapping(state: InputControllerPlayerSlot, actionStringId: StringId, bindStringId: StringId): void {
		const actionName = this.strings.toString(actionStringId);
		this.removeActionBindings(state, actionName);
		this.appendBindings(state, actionName, this.strings.toString(bindStringId));
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

	private sampleLoadedBindings(playerInput: PlayerInput, state: InputControllerPlayerSlot): void {
		for (let index = 0; index < state.bindings.length; index += 1) {
			const binding = state.bindings[index]!;
			if (this.findSampledButton(state, binding.source, binding.button) === undefined) {
				this.writeSampledButton(state, binding.source, binding.button, playerInput.getButtonState(binding.button, binding.source));
			}
		}
	}

	private writeSampledButton(state: InputControllerPlayerSlot, source: InputSource, button: ButtonId, buttonState: ButtonState): void {
		let sampled = state.sampledButtons[state.sampledButtonCount];
		if (sampled === undefined) {
			sampled = { source, button, state: buttonState };
			state.sampledButtons[state.sampledButtonCount] = sampled;
		} else {
			sampled.source = source;
			sampled.button = button;
			sampled.state = buttonState;
		}
		state.sampledButtonCount += 1;
	}

	private createSampledActionState(state: InputControllerPlayerSlot, actionName: string): ActionState {
		const result = makeActionState(actionName);
		let sourceCount = 0;
		sourceCount += this.mergeSourceActionState(result, state, actionName, 'keyboard');
		sourceCount += this.mergeSourceActionState(result, state, actionName, 'gamepad');
		sourceCount += this.mergeSourceActionState(result, state, actionName, 'pointer');
		if (sourceCount === 0) {
			return result;
		}
		return result;
	}

	private mergeSourceActionState(result: ActionState, state: InputControllerPlayerSlot, actionName: string, source: InputSource): number {
		let sourcePressed = true;
		let sourceJustPressed = false;
		let sourceAllJustPressed = true;
		let sourceJustReleased = false;
		let sourceAllJustReleased = true;
		let sourceWasPressed = false;
		let sourceAllWasPressed = true;
		let sourceWasReleased = false;
		let sourceConsumed = false;
		let sourcePresstime: number = null;
		let sourceTimestamp: number = null;
		let sourcePressId: number = null;
		let sourceValue: number = null;
		let sourceValueAbs = -1;
		let sourceValue2d: [number, number] = null;
		let sourceBindings = 0;
		for (let index = 0; index < state.bindings.length; index += 1) {
			const binding = state.bindings[index]!;
			if (binding.actionName !== actionName || binding.source !== source) {
				continue;
			}
			const sampled = this.findSampledButton(state, source, binding.button);
			if (sampled === undefined) {
				return 0;
			}
			sourceBindings += 1;
			const buttonState = sampled.state;
			sourcePressed = sourcePressed && buttonState.pressed;
			sourceJustPressed = sourceJustPressed || buttonState.justpressed;
			sourceAllJustPressed = sourceAllJustPressed && buttonState.justpressed;
			sourceJustReleased = sourceJustReleased || buttonState.justreleased;
			sourceAllJustReleased = sourceAllJustReleased && buttonState.justreleased;
			sourceWasPressed = sourceWasPressed || buttonState.waspressed;
			sourceAllWasPressed = sourceAllWasPressed && buttonState.waspressed;
			sourceWasReleased = sourceWasReleased || buttonState.wasreleased;
			sourceConsumed = sourceConsumed || buttonState.consumed;
			if (buttonState.presstime !== null && buttonState.presstime !== undefined && (sourcePresstime === null || buttonState.presstime < sourcePresstime)) {
				sourcePresstime = buttonState.presstime;
			}
			if (buttonState.timestamp !== null && buttonState.timestamp !== undefined && (sourceTimestamp === null || buttonState.timestamp > sourceTimestamp)) {
				sourceTimestamp = buttonState.timestamp;
			}
			if (buttonState.pressId !== null && buttonState.pressId !== undefined && (sourcePressId === null || buttonState.pressId > sourcePressId)) {
				sourcePressId = buttonState.pressId;
			}
			if (buttonState.value !== null && buttonState.value !== undefined) {
				const abs = Math.abs(buttonState.value);
				if (abs > sourceValueAbs) {
					sourceValueAbs = abs;
					sourceValue = buttonState.value;
				}
			}
			if (buttonState.value2d !== null && buttonState.value2d !== undefined) {
				sourceValue2d = buttonState.value2d;
			}
		}
		if (sourceBindings === 0) {
			return 0;
		}
		result.pressed = result.pressed || sourcePressed;
		result.justpressed = result.justpressed || (sourcePressed && sourceJustPressed);
		result.justreleased = result.justreleased || (!sourcePressed && sourceJustReleased);
		result.waspressed = result.waspressed || sourceWasPressed;
		result.wasreleased = result.wasreleased || sourceWasReleased;
		result.consumed = result.consumed || sourceConsumed;
		result.alljustpressed = result.alljustpressed || sourceAllJustPressed;
		result.alljustreleased = result.alljustreleased || sourceAllJustReleased;
		result.allwaspressed = result.allwaspressed || sourceAllWasPressed;
		if (sourcePresstime !== null && (result.presstime === null || sourcePresstime < result.presstime)) {
			result.presstime = sourcePresstime;
		}
		if (sourceTimestamp !== null && (result.timestamp === null || sourceTimestamp > result.timestamp)) {
			result.timestamp = sourceTimestamp;
		}
		if (sourcePressId !== null && (result.pressId === null || sourcePressId > result.pressId)) {
			result.pressId = sourcePressId;
		}
		if (sourceValue !== null) {
			const resultValueAbs = result.value === null || result.value === undefined ? -1 : Math.abs(result.value);
			if (sourceValueAbs > resultValueAbs) {
				result.value = sourceValue;
			}
		}
		if (sourceValue2d !== null) {
			result.value2d = sourceValue2d;
		}
		return 1;
	}

	private findSampledButton(state: InputControllerPlayerSlot, source: InputSource, button: ButtonId): InputControllerSampledButtonState | undefined {
		for (let index = 0; index < state.sampledButtonCount; index += 1) {
			const sampled = state.sampledButtons[index]!;
			if (sampled.source === source && sampled.button === button) {
				return sampled;
			}
		}
		return undefined;
	}

	private consumeActionButtons(playerInput: PlayerInput, state: InputControllerPlayerSlot, actionName: string): void {
		for (let index = 0; index < state.bindings.length; index += 1) {
			const binding = state.bindings[index]!;
			if (binding.actionName !== actionName) {
				continue;
			}
			const sampled = this.findSampledButton(state, binding.source, binding.button);
			if (sampled !== undefined && sampled.state.pressed && !sampled.state.consumed) {
				playerInput.consumeRawButton(binding.button, binding.source);
				sampled.state.consumed = true;
			}
		}
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

	private appendBindings(state: InputControllerPlayerSlot, actionName: string, bindingsText: string): void {
		let bindingStart = 0;
		for (let index = 0; index <= bindingsText.length; index += 1) {
			if (index !== bindingsText.length && bindingsText.charCodeAt(index) !== 44) {
				continue;
			}
			this.appendTokenBindings(state, actionName, bindingsText.slice(bindingStart, index) as BGamepadButton);
			bindingStart = index + 1;
		}
	}

	private appendTokenBindings(state: InputControllerPlayerSlot, actionName: string, binding: BGamepadButton): void {
		if (binding.length > 2 && binding.charCodeAt(1) === 58) {
			const button = binding.slice(2);
			const sourceKind = binding.charCodeAt(0);
			if (sourceKind === 107) {
				this.addBinding(state, actionName, 'keyboard', button);
				return;
			}
			if (sourceKind === 103) {
				this.addBinding(state, actionName, 'gamepad', button);
				return;
			}
			if (sourceKind === 112) {
				this.addBinding(state, actionName, 'pointer', button);
				return;
			}
		}
		if (this.isKeyboardButtonToken(binding)) {
			this.addBinding(state, actionName, 'keyboard', binding);
			return;
		}
		const defaultPointerBindings = Input.DEFAULT_INPUT_MAPPING.pointer[binding];
		if (defaultPointerBindings) {
			for (let bindingIndex = 0; bindingIndex < defaultPointerBindings.length; bindingIndex += 1) {
				this.addBinding(state, actionName, 'pointer', inputBindingId(defaultPointerBindings[bindingIndex]!));
			}
			return;
		}
		const defaultKeyboardBindings = Input.DEFAULT_INPUT_MAPPING.keyboard[binding];
		const defaultGamepadBindings = Input.DEFAULT_INPUT_MAPPING.gamepad[binding];
		if (defaultKeyboardBindings || defaultGamepadBindings) {
			if (defaultKeyboardBindings) {
				for (let bindingIndex = 0; bindingIndex < defaultKeyboardBindings.length; bindingIndex += 1) {
					this.addBinding(state, actionName, 'keyboard', inputBindingId(defaultKeyboardBindings[bindingIndex]!));
				}
			}
			if (defaultGamepadBindings) {
				for (let bindingIndex = 0; bindingIndex < defaultGamepadBindings.length; bindingIndex += 1) {
					this.addBinding(state, actionName, 'gamepad', inputBindingId(defaultGamepadBindings[bindingIndex]!));
				}
			}
			return;
		}
		this.addBinding(state, actionName, 'keyboard', binding);
	}

	private isKeyboardButtonToken(binding: string): boolean {
		return binding.length > 3 && binding.slice(0, 3) === 'Key'
			|| binding.length > 5 && binding.slice(0, 5) === 'Digit'
			|| binding.length > 5 && binding.slice(0, 5) === 'Arrow'
			|| binding.length > 5 && binding.slice(0, 5) === 'Shift'
			|| binding.length > 4 && binding.slice(0, 4) === 'Ctrl'
			|| binding.length > 7 && binding.slice(0, 7) === 'Control'
			|| binding.length > 3 && binding.slice(0, 3) === 'Alt'
			|| binding.length > 4 && binding.slice(0, 4) === 'Meta'
			|| binding === 'Enter'
			|| binding === 'Backspace'
			|| binding === 'Escape'
			|| binding === 'Space';
	}

	private loadDefaultBindings(state: InputControllerPlayerSlot): void {
		for (const actionName in Input.DEFAULT_INPUT_MAPPING.keyboard) {
			const bindings = Input.DEFAULT_INPUT_MAPPING.keyboard[actionName]!;
			for (let index = 0; index < bindings.length; index += 1) {
				this.addBinding(state, actionName, 'keyboard', inputBindingId(bindings[index]!));
			}
		}
		for (const actionName in Input.DEFAULT_INPUT_MAPPING.gamepad) {
			const bindings = Input.DEFAULT_INPUT_MAPPING.gamepad[actionName]!;
			for (let index = 0; index < bindings.length; index += 1) {
				this.addBinding(state, actionName, 'gamepad', inputBindingId(bindings[index]!));
			}
		}
		for (const actionName in Input.DEFAULT_INPUT_MAPPING.pointer) {
			const bindings = Input.DEFAULT_INPUT_MAPPING.pointer[actionName]!;
			for (let index = 0; index < bindings.length; index += 1) {
				this.addBinding(state, actionName, 'pointer', inputBindingId(bindings[index]!));
			}
		}
	}

	private removeActionBindings(state: InputControllerPlayerSlot, actionName: string): void {
		let write = 0;
		for (let read = 0; read < state.bindings.length; read += 1) {
			const binding = state.bindings[read]!;
			if (binding.actionName !== actionName) {
				state.bindings[write] = binding;
				write += 1;
			}
		}
		state.bindings.length = write;
	}

	private addBinding(state: InputControllerPlayerSlot, actionName: string, source: InputSource, button: ButtonId): void {
		state.bindings.push({ actionName, source, button });
	}

}
