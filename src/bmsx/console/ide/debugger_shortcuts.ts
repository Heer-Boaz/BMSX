import type { KeyboardInput } from '../../input/keyboardinput';
import { BmsxConsoleRuntime } from '../runtime.ts';
import { consumeKey as consumeKeyboardKey, isKeyJustPressed as isKeyJustPressedGlobal } from './input_helpers';

type ShortcutContext = {
	keyboard: KeyboardInput;
	playerIndex: number;
	ctrlDown: boolean;
	altDown: boolean;
	metaDown: boolean;
	shiftDown: boolean;
};

export function handleDebuggerShortcuts(context: ShortcutContext): boolean {
	const runtime = BmsxConsoleRuntime.instance;
	if (!runtime) {
		return false;
	}
	const suspension = runtime.getLuaDebuggerSuspension();
	if (!suspension) {
		return false;
	}
	if (context.ctrlDown || context.altDown || context.metaDown) {
		return false;
	}
	if (isKeyJustPressedGlobal(context.playerIndex, 'F10')) {
		consumeKeyboardKey(context.keyboard, 'F10', context.playerIndex);
		runtime.stepOverLuaDebugger();
		return true;
	}
	const f11Pressed = isKeyJustPressedGlobal(context.playerIndex, 'F11');
	if (f11Pressed) {
		consumeKeyboardKey(context.keyboard, 'F11', context.playerIndex);
		if (context.shiftDown) {
			runtime.stepOutLuaDebugger();
		}
		else {
			runtime.stepIntoLuaDebugger();
		}
		return true;
	}
	return false;
}
