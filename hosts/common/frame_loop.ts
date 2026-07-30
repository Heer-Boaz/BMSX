import type { MonoTime } from './clock';

export interface FrameLoop {
	start(tick: (time: MonoTime) => void): { stop(): void };
}
