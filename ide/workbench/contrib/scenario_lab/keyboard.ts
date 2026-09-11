import type { PlayerInput } from '../../../../hosts/common/input/player';
import {
	consumeIdeKey,
	isKeyJustPressed,
	shouldRepeatKeyFromPlayer,
} from '../../../input/keyboard/key_input';
import type { BGamepadButton } from '../../../../hosts/common/input/models';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import type { IdeCommandController } from '../../../commands/controller';
import type { ScenarioLabNavigationCommand } from './navigation';

type ScenarioLabKeyboardNavigationBinding = {
	readonly code: string;
	readonly command: ScenarioLabNavigationCommand;
};

const scenarioLabKeyboardRepeatNavigationBindings: readonly ScenarioLabKeyboardNavigationBinding[] = [
	{ code: 'ArrowUp', command: 'up' },
	{ code: 'ArrowDown', command: 'down' },
	{ code: 'ArrowLeft', command: 'left' },
	{ code: 'ArrowRight', command: 'right' },
	{ code: 'PageUp', command: 'page-up' },
	{ code: 'PageDown', command: 'page-down' },
	{ code: 'Home', command: 'home' },
	{ code: 'End', command: 'end' },
];

const scenarioLabKeyboardPressNavigationBindings: readonly ScenarioLabKeyboardNavigationBinding[] = [
	{ code: 'Enter', command: 'activate' },
	{ code: 'NumpadEnter', command: 'activate' },
];

const scenarioLabGamepadNavigationBindings: readonly {
	readonly button: BGamepadButton;
	readonly command: ScenarioLabNavigationCommand;
}[] = [
	{ button: 'up', command: 'up' },
	{ button: 'down', command: 'down' },
	{ button: 'left', command: 'left' },
	{ button: 'right', command: 'right' },
];

const scenarioLabGamepadCommandBindings: readonly {
	readonly button: BGamepadButton;
	readonly command: EditorScenarioLabCommandId;
}[] = [
	{ button: 'x', command: 'scenarioLab.run' },
	{ button: 'y', command: 'scenarioLab.rerun' },
	{ button: 'start', command: 'scenarioLab.cancel' },
];

export function handleScenarioLabKeyboardInput(
	playerInput: PlayerInput,
	navigate: (command: ScenarioLabNavigationCommand) => void,
): boolean {
	for (let index = 0; index < scenarioLabKeyboardRepeatNavigationBindings.length; index += 1) {
		const binding = scenarioLabKeyboardRepeatNavigationBindings[index];
		if (shouldRepeatKeyFromPlayer(binding.code, playerInput)) {
			consumeIdeKey(binding.code, playerInput);
			navigate(binding.command);
			return true;
		}
	}
	for (let index = 0; index < scenarioLabKeyboardPressNavigationBindings.length; index += 1) {
		const binding = scenarioLabKeyboardPressNavigationBindings[index];
		if (isKeyJustPressed(binding.code, playerInput)) {
			consumeIdeKey(binding.code, playerInput);
			navigate(binding.command);
			return true;
		}
	}
	return false;
}

export function handleScenarioLabGamepadInput(
	playerInput: PlayerInput,
	navigate: (command: ScenarioLabNavigationCommand) => void,
	commands: IdeCommandController,
): boolean {
	const gamepad = playerInput.inputHandlers.gamepad;
	if (gamepad === null) {
		return false;
	}
	for (let index = 0; index < scenarioLabGamepadNavigationBindings.length; index += 1) {
		const binding = scenarioLabGamepadNavigationBindings[index];
		if (playerInput.controlButtonRepeatEdge(binding.button, 'gamepad')) {
			gamepad.consumeButton(binding.button);
			navigate(binding.command);
			return true;
		}
	}
	const activate = gamepad.getButtonState('a');
	if (activate.justpressed && !activate.consumed) {
		gamepad.consumeButton('a');
		navigate('activate');
		return true;
	}
	for (let index = 0; index < scenarioLabGamepadCommandBindings.length; index += 1) {
		const binding = scenarioLabGamepadCommandBindings[index];
		const state = gamepad.getButtonState(binding.button);
		if (state.justpressed && !state.consumed) {
			gamepad.consumeButton(binding.button);
			if (commands.isEnabled(binding.command)) {
				commands.execute(binding.command);
			}
			return true;
		}
	}
	return false;
}
