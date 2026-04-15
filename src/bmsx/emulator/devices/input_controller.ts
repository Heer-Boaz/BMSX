import { Input } from '../../input/input';
import type { GamepadBinding, GamepadInputMapping, KeyboardBinding, KeyboardInputMapping } from '../../input/inputtypes';
import {
	INP_CTRL_COMMIT,
	INP_CTRL_LATCH,
	INP_CTRL_RESET,
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
} from '../io';
import { Memory } from '../memory';
import type { StringValue } from '../string_pool';

const INP_CONTEXT_ID = 'inp_chip';

type PlayerChipState = {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	contextPushed: boolean;
	latchedFrame: number;
};

export class InputController {
	private readonly playerStates: PlayerChipState[] = Array.from(
		{ length: Input.PLAYERS_MAX },
		(): PlayerChipState => ({
			keyboard: {},
			gamepad: {},
			contextPushed: false,
			latchedFrame: 0,
		}),
	);

	public constructor(
		private readonly memory: Memory,
		private readonly input: Input,
	) {}

	public reset(): void {
		for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
			const state = this.playerStates[playerIndex - 1]!;
			if (state.contextPushed) {
				this.input.getPlayerInput(playerIndex).popContext(INP_CONTEXT_ID);
			}
			state.keyboard = {};
			state.gamepad = {};
			state.contextPushed = false;
			state.latchedFrame = 0;
		}
		this.memory.writeValue(IO_INP_PLAYER, 1);
		this.memory.writeValue(IO_INP_STATUS, 0);
		this.memory.writeValue(IO_INP_VALUE, 0);
	}

	public onCtrlWrite(): void {
		switch (this.memory.readValue(IO_INP_CTRL) as number) {
			case INP_CTRL_COMMIT:
				this.commitAction();
				return;
			case INP_CTRL_LATCH:
				this.latchInput();
				return;
			case INP_CTRL_RESET:
				this.resetActions();
				return;
		}
	}

	public onQueryWrite(): void {
		const query = this.memory.readValue(IO_INP_QUERY) as StringValue;
		const playerInput = this.input.getPlayerInput(this.memory.readValue(IO_INP_PLAYER) as number);
		const triggered = playerInput.checkActionTriggered(query.text);
		this.memory.writeValue(IO_INP_STATUS, triggered ? 1 : 0);
		this.memory.writeValue(IO_INP_VALUE, 0);
	}

	public onConsumeWrite(): void {
		const actionName = (this.memory.readValue(IO_INP_CONSUME) as StringValue).text;
		this.input.getPlayerInput(this.memory.readValue(IO_INP_PLAYER) as number).consumeAction(actionName);
	}

	private commitAction(): void {
		const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
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

	private latchInput(): void {
		const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
		const playerInput = this.input.getPlayerInput(playerIndex);
		this.playerStates[playerIndex - 1]!.latchedFrame = playerInput.pollFrame;
	}

	private resetActions(): void {
		const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
		const state = this.playerStates[playerIndex - 1]!;
		if (state.contextPushed) {
			this.input.getPlayerInput(playerIndex).popContext(INP_CONTEXT_ID);
		}
		state.keyboard = {};
		state.gamepad = {};
		state.contextPushed = false;
		state.latchedFrame = 0;
		this.memory.writeValue(IO_INP_STATUS, 0);
		this.memory.writeValue(IO_INP_VALUE, 0);
	}

	private appendBindings(bindingsText: string, keyboardBindings: KeyboardBinding[], gamepadBindings: GamepadBinding[]): void {
		let bindingStart = 0;
		for (let index = 0; index <= bindingsText.length; index += 1) {
			if (index !== bindingsText.length && bindingsText.charCodeAt(index) !== 44) {
				continue;
			}
			const binding = bindingsText.slice(bindingStart, index);
			const defaultKeyboardBindings = Input.DEFAULT_INPUT_MAPPING.keyboard[binding];
			if (defaultKeyboardBindings) {
				for (let bindingIndex = 0; bindingIndex < defaultKeyboardBindings.length; bindingIndex += 1) {
					keyboardBindings.push(defaultKeyboardBindings[bindingIndex]!);
				}
			}
			gamepadBindings.push({ id: binding as never });
			bindingStart = index + 1;
		}
	}
}
