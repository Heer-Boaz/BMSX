import type { MonoTime } from '../clock';

export type DeviceKind = 'keyboard' | 'gamepad' | 'pointer' | 'touch' | 'virtual';

export type InputEvt =
	| { type: 'button'; deviceId: string; code: string; down: boolean; value?: number; timestamp: MonoTime; pressId?: number }
	| { type: 'supervisor-request'; down: boolean; timestamp: MonoTime }
	| { type: 'axis1'; deviceId: string; code: string; x: number; timestamp: MonoTime }
	| { type: 'axis2'; deviceId: string; code: string; x: number; y: number; timestamp: MonoTime }
	| { type: 'connect'; device: InputDevice; timestamp: MonoTime }
	| { type: 'disconnect'; deviceId: string; timestamp: MonoTime }
	| { type: 'reset' };

interface InputDeviceIdentity {
	id: string;
	kind: DeviceKind;
}

export interface GamepadDevice extends InputDeviceIdentity {
	kind: 'gamepad';
	gamepadIndex: number;
	vibrationInitializationRequired: boolean;
	supportsVibration: boolean;
	initializeVibration(): Promise<void>;
	setVibration(durationMs: number, intensity: number): void;
}

interface NonGamepadDevice extends InputDeviceIdentity {
	kind: Exclude<DeviceKind, 'gamepad'>;
}

export type InputDevice = GamepadDevice | NonGamepadDevice;

export interface InputEventSink {
	resetInput(): void;
	setSupervisorRequestLine(down: boolean): void;
	connectInputDevice(device: InputDevice): void;
	disconnectInputDevice(deviceId: string): void;
	inputButton(
		deviceId: string,
		code: string,
		down: boolean,
		value: number,
		timestamp: MonoTime,
		pressId: number,
	): void;
	inputAxis1(deviceId: string, code: string, x: number, timestamp: MonoTime): void;
	inputAxis2(deviceId: string, code: string, x: number, y: number, timestamp: MonoTime): void;
}

export interface InputHub {
	subscribe(sink: InputEventSink): () => void;
	post(event: InputEvt): void;
	devices(): InputDevice[];
	poll(time: MonoTime): void;
	setKeyboardCapture(handler: (code: string) => boolean): void;
}
