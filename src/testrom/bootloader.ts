import { BFont, BGamepadButton, BootArgs, GamepadInputMapping, KeyboardButton, KeyboardInputMapping, Input, $, WorldConfiguration } from 'bmsx';
import { createTestromModule } from './worldmodule';
import { BitmapId } from './resourceids';
// Ensure FSM blueprint is registered
import './test_gamemodel';

// Find all(xyz) and replace them. Codex is stupid and always inserts buggy `as any`.
// (\s*\(([^)]+?)\s+as\s+any\s*\))
// ($2)

const globalTarget = globalThis as { h406A?: (args: BootArgs) => Promise<void> };

globalTarget.h406A = (args: BootArgs): Promise<any> => {
	const platform = args.platform;
	if (!platform) {
		throw new Error('[Bootloader:testrom] Platform instance not provided. Ensure the host supplies it in BootArgs.');
	}
	let viewHost = args.viewHost ?? platform.gameviewHost;
	if (!viewHost) {
		throw new Error('[Bootloader:testrom] View host not provided by Platform.');
	}
	const worldConfiguration: WorldConfiguration = { viewportSize: { width: 320, height: 240 }, fsmId: 'testrom_world_fsm', modules: [createTestromModule()] };

	return $.init({
		rompack: args.rompack,
		worldConfig: worldConfiguration,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug,
		startingGamepadIndex: args.startingGamepadIndex,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform,
		viewHost,
	}).then(() => {
		$.view.default_font = new BFont(BitmapId);
		$.set_inputmap(1, { keyboard: keyboardInputMapping, gamepad: gamepadInputMapping, pointer: Input.clonePointerMapping() });
		$.start();
	});
};

const actions = ['up', 'right', 'down', 'left', 'panleft', 'panright', 'switch_camera', 'bla', 'blap', 'moveforward', 'movebackward', 'turnleft', 'turnright', 'rotateleft', 'rotateright', 'panup', 'pandown', 'pitchup', 'pitchdown', 'toggleprojection', 'fire'] as const;
export type InputAction = typeof actions[number];

type MyKeyboardInputMapping = {
	[key in keyof KeyboardInputMapping & InputAction]: KeyboardButton[];
};

type MyGamepadInputMapping = {
	[key in keyof GamepadInputMapping & InputAction]: BGamepadButton[];
};

export const keyboardInputMapping: MyKeyboardInputMapping = {
	'up': ['ArrowUp'],
	'right': ['ArrowRight'],
	'down': ['ArrowDown'],
	'left': ['ArrowLeft'],
	'switch_camera': ['KeyZ'],           // Switch camera
	'bla': ['KeyW'],            // Move forward
	'blap': ['KeyS'],           // Move backward
	'moveforward': ['KeyW'],    // Move forward
	'movebackward': ['KeyS'],   // Move backward
	'turnleft': ['KeyA'],       // Turn left
	'turnright': ['KeyD'],      // Turn right
	'panleft': ['KeyQ'],       // Pan left
	'panright': ['KeyE'],      // Pan right
	'rotateleft': ['Digit1'],    // Rotate left
	'rotateright': ['Digit3'],   // Rotate right
	'panup': ['KeyR'],         // Pan up
	'pandown': ['KeyF'],      // Pan down
	'pitchup': ['KeyT'],      // Pitch up
	'pitchdown': ['KeyG'],    // Pitch down
	'toggleprojection': ['KeyP'], // Toggle projection
	'fire': ['ShiftLeft'],
};

export const gamepadInputMapping: MyGamepadInputMapping = {
	'up': ['up'],
	'right': ['right'],
	'down': ['down'],
	'left': ['left'],
	'switch_camera': ['b'],
	'bla': ['x'],
	'blap': ['y'],
	'turnleft': ['left'],
	'turnright': ['right'],
	'moveforward': ['x'],
	'movebackward': ['y'],
	'panleft': ['lb'],
	'panright': ['rb'],
	'rotateleft': ['lt'],
	'rotateright': ['rt'],
	'panup': ['home'],
	'pandown': ['select'],
	'pitchup': ['up'],
	'pitchdown': ['down'],
	'toggleprojection': ['x', 'y'], // Toggle projection
	'fire': ['a'],
};

// Custom view subclass was removed; using GameView directly. Extend here only if per-ROM overrides are needed.
