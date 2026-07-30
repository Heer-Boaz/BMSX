import type { HostClock } from '../common/clock';
import { SonyGamepadHID, sonyGamepadProductId } from './sony_gamepad_hid';

export interface GamepadHaptics {
	readonly connected: boolean;
	initialize(): Promise<void>;
	setVibration(durationMs: number, intensity: number): void;
	disconnect(): void;
}

export function createGamepadHaptics(
	gamepadIndex: number,
	description: string,
	clock: HostClock,
): GamepadHaptics | null {
	if (!('hid' in navigator)) {
		return null;
	}
	const sonyProductId = sonyGamepadProductId(description);
	return sonyProductId > 0
		? new SonyGamepadHID(gamepadIndex, sonyProductId, clock)
		: null;
}
