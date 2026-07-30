export type MonoTime = number;

export interface TimerHandle {
	cancel(): void;
	isActive(): boolean;
}

export interface HostClock {
	now(): MonoTime;
	dateNow(): number;
	scheduleOnce(delayMs: number, callback: (time: MonoTime) => void): TimerHandle;
}
