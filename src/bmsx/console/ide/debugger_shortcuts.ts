import { consumeKey as consumeKeyboardKey, isKeyJustPressed as isKeyJustPressedGlobal } from './input_helpers';
import { evaluateDebuggerShortcuts, type DebuggerShortcutContext } from './debugger_shortcuts_core';
import { prepareDebuggerStepOverlay } from './debugger_overlay_controller';
import { getDebuggerCommandExecutor } from './debugger_controls';

type ShortcutContext = {
	keyboard: any; // Hack to prevent having to import engine types
	playerIndex: number;
	ctrlDown: boolean;
	altDown: boolean;
	metaDown: boolean;
	shiftDown: boolean;
};

export function handleDebuggerShortcuts(context: ShortcutContext): boolean {
	const executor = getDebuggerCommandExecutor();
	const evalContext: DebuggerShortcutContext = {
		ctrlDown: context.ctrlDown,
		altDown: context.altDown,
		metaDown: context.metaDown,
		shiftDown: context.shiftDown,
		isKeyJustPressed: (code) => isKeyJustPressedGlobal(context.playerIndex, code),
		consumeKey: (code) => consumeKeyboardKey(context.keyboard, code, context.playerIndex),
	};
	const handled = evaluateDebuggerShortcuts(evalContext, executor);
	if (handled) {
		prepareDebuggerStepOverlay();
	}
	return handled;
}
