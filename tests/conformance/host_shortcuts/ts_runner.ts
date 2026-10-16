import { readFileSync } from 'node:fs';
import { Input } from '../../../hosts/common/input/manager';
import { GAMEPAD_BUTTON_IDS } from '../../../hosts/common/input/gamepad_buttons';
import type { GamepadDevice } from '../../../hosts/common/input/contracts';
import { ControlSource, HOST_MENU_HOLD_MS } from '../../../hosts/common/input/shortcuts';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { createInputControllerSnapshot, InputControllerGamepadButtonBit as Button, InputControllerSampleContext } from '../../../machine/ts/machine/devices/input/contracts';

const physicalKeys = [
	[Button.Select, 'ControlRight'], [Button.Start, 'AltRight'], [Button.LeftBumper, 'ShiftLeft'],
	[Button.A, 'KeyX'], [Button.X, 'KeyZ'],
] as const;

class Fixture {
	readonly clock = new VirtualHeadlessClock();
	readonly input = new Input(this.clock, { devices: () => [], subscribe: () => () => {} }, -1);
	readonly snapshot = createInputControllerSnapshot();
	readonly pads = [0, 0, 0, 0];
	readonly connected = [true, true, true, true];
	private keyboard = 0;
	private virtual = 0;
	private pressId = 0;
	private action = 0;
	private keyboardOpened = false;

	constructor() {
		const shortcuts = this.input.getGlobalShortcutRegistry();
		for (let index = 0; index < this.pads.length; index++) {
			this.input.connectInputDevice(this.device(index));
			shortcuts.registerControlShortcut(index + 1, 'start', {
				kind: 'short-hold', holdDurationMs: HOST_MENU_HOLD_MS,
				onShortPress: () => { this.action = Math.max(this.action, 1); },
				onLongPress: () => { this.action = 2; },
			});
			shortcuts.registerControlShortcut(index + 1, 'x', {
				kind: 'press', onPressed: () => { this.keyboardOpened = true; },
			}, ControlSource.Gamepad);
		}
	}
	private device(index: number): GamepadDevice {
		return { id: `gamepad:${index}`, kind: 'gamepad', gamepadIndex: index, label: 'PARITY',
			vibrationInitialization: null, supportsVibration: false, setVibration() {} };
	}
	private button(device: string, code: string, down: boolean): void {
		this.input.inputButton(device, code, down, down ? 1 : 0, this.clock.now(), ++this.pressId);
	}
	setVirtual(word: number): void {
		for (const [bit, code] of physicalKeys) {
			if (((this.virtual ^ word) & (1 << bit)) !== 0) this.input.setVirtualKeyboardKey(code, (word & (1 << bit)) !== 0);
		}
		this.virtual = word;
	}
	deviceChanged(index: number, enabled: boolean): void {
		if (enabled) this.input.connectInputDevice(this.device(index));
		else this.input.disconnectInputDevice(`gamepad:${index}`);
		this.connected[index] = enabled;
		this.pads[index] = 0;
	}
	resetInput(): void {
		this.input.resetInput();
		this.keyboard = this.virtual = 0;
		this.pads.fill(0);
	}
	frame(time: number, keyboard: number, pads: number[]): void {
		this.action = 0;
		this.keyboardOpened = false;
		this.clock.advance(time - this.clock.now());
		for (const [bit, code] of physicalKeys) {
			if (((this.keyboard ^ keyboard) & (1 << bit)) !== 0) this.button('keyboard:0', code, (keyboard & (1 << bit)) !== 0);
		}
		this.keyboard = keyboard;
		for (let index = 0; index < this.pads.length; index++) {
			if (!this.connected[index]) continue;
			for (let bit = 0; bit < GAMEPAD_BUTTON_IDS.length; bit++) {
				if (((this.pads[index] ^ pads[index]) & (1 << bit)) !== 0) this.button(`gamepad:${index}`, GAMEPAD_BUTTON_IDS[bit], (pads[index] & (1 << bit)) !== 0);
			}
			this.pads[index] = pads[index];
		}
		this.input.pollInput();
		this.input.sampleInputControllerSnapshot(this.snapshot, InputControllerSampleContext.Normal);
		console.log(JSON.stringify({ action: this.action, keyboard: this.keyboardOpened,
			pads: this.snapshot.pads.map(pad => pad.buttons), keys: Array.from(this.snapshot.keyWords) }));
	}
}

let fixture: Fixture;
for (const line of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
	const [op, ...values] = line.split(' ');
	const args = values.map(Number);
	switch (op) {
		case 'RESET': fixture?.input.dispose(); fixture = new Fixture(); break;
		case 'FRAME': fixture.frame(args[0], args[1], args.slice(2)); break;
		case 'CANCEL': fixture.input.getGlobalShortcutRegistry().cancelControlShortcutGestures(); break;
		case 'MASK': fixture.input.getGlobalShortcutRegistry().setGamepadControlShortcutMask(args[0]); break;
		case 'DEVICE': fixture.deviceChanged(args[0], args[1] !== 0); break;
		case 'VIRTUAL': fixture.setVirtual(args[0]); break;
		case 'INPUT_RESET': fixture.resetInput(); break;
		default: throw new Error(`Unknown host shortcut vector: ${line}`);
	}
}
fixture.input.dispose();
