import type { InputControllerInputSource } from '../devices/input/contracts';

export interface RuntimeInputSource extends InputControllerInputSource {
	setRuntimeInputFrameDurationMs(frameDurationMs: number): void;
}
