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
import type { StringValue } from '../../memory/string/pool';

const INP_CONTEXT_ID = 'inp_chip';

type PlayerChipState = {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	contextPushed: boolean;
};

export type InputControllerState = {
	sampleArmed: boolean;
};

export class InputController {
	private readonly playerStates: PlayerChipState[] = Array.from(
		{ length: Input.PLAYERS_MAX },
		(): PlayerChipState => ({
			keyboard: {},
			gamepad: {},
			contextPushed: false,
		}),
	);
	public sampleArmed = false;

	public constructor(
		private readonly memory: Memory,
		private readonly input: Input,
	) {
		this.memory.mapIoWrite(IO_INP_CTRL, this.onCtrlWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_QUERY, this.onQueryWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_CONSUME, this.onConsumeWrite.bind(this));
	}

	public reset(): void {
		this.sampleArmed = false;
		for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
			const state = this.playerStates[playerIndex - 1]!;
			this.clearPlayerActions(playerIndex, state);
		}
		this.memory.writeValue(IO_INP_PLAYER, 1);
		this.memory.writeIoValue(IO_INP_CTRL, 0);
		this.memory.writeValue(IO_INP_STATUS, 0);
		this.memory.writeValue(IO_INP_VALUE, 0);
	}

	public onCtrlWrite(): void {
		switch (this.memory.readIoU32(IO_INP_CTRL)) {
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
		};
	}

	public restoreState(state: InputControllerState): void {
		this.sampleArmed = state.sampleArmed;
	}

	public onQueryWrite(): void {
		const query = this.memory.readValue(IO_INP_QUERY) as StringValue;
		const playerInput = this.input.getPlayerInput(this.memory.readIoU32(IO_INP_PLAYER));
		const triggered = playerInput.checkActionTriggered(query.text);
		this.memory.writeValue(IO_INP_STATUS, triggered ? 1 : 0);
		this.memory.writeValue(IO_INP_VALUE, 0);
	}

	public onConsumeWrite(): void {
		const actionNames = (this.memory.readValue(IO_INP_CONSUME) as StringValue).text;
		const playerInput = this.input.getPlayerInput(this.memory.readIoU32(IO_INP_PLAYER));
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
		const playerIndex = this.memory.readIoU32(IO_INP_PLAYER);
		const state = this.playerStates[playerIndex - 1]!;
		const actionName = (this.memory.readValue(IO_INP_ACTION) as StringValue).text;
		const bindingsText = (this.memory.readValue(IO_INP_BIND) as StringValue).text;
		const keyboardBindings: KeyboardBinding[] = [];
		const gamepadBindings: GamepadBinding[] = [];
		this.appendBindings(bindingsText, keyboardBindings, gamepadBindings);
		state.keyboard[actionName] = keyboardBindings;
		state.gamepad[actionName] = gamepadBindings;
		const playerInput = this.input.getPlayerInput(playerIndex);
		if (state.contextPushed) {
			playerInput.popContext(INP_CONTEXT_ID);
		}
		playerInput.pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
		state.contextPushed = true;
	}

	private resetActions(): void {
		const playerIndex = this.memory.readIoU32(IO_INP_PLAYER);
		const state = this.playerStates[playerIndex - 1]!;
		this.clearPlayerActions(playerIndex, state);
		this.memory.writeValue(IO_INP_STATUS, 0);
		this.memory.writeValue(IO_INP_VALUE, 0);
	}

	private clearPlayerActions(playerIndex: number, state: PlayerChipState): void {
		if (state.contextPushed) {
			this.input.getPlayerInput(playerIndex).popContext(INP_CONTEXT_ID);
		}
		state.keyboard = {};
		state.gamepad = {};
		state.contextPushed = false;
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
