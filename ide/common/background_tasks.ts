import { machineManager } from '../../machine/ts/core/machine_manager';
import { scheduleMicrotask, type TimerHandle } from '../../machine/ts/platform/platform';

export type BackgroundTask = () => boolean;

const backgroundTasks: BackgroundTask[] = [];
let backgroundTaskHandle: TimerHandle = null;
let runtimeTaskTail = Promise.resolve();
let pendingRuntimeTasks = 0;
let runtimeTaskQueueFailed = false;
const backgroundTaskBudgetMs = 2.0;

export function enqueueBackgroundTask(task: BackgroundTask): void {
	backgroundTasks.push(task);
	if (backgroundTaskHandle === null) {
		backgroundTaskHandle = scheduleIdeOnce(0, runBackgroundTasks);
	}
}

export function runBackgroundTasks(): void {
	backgroundTaskHandle = null;
	if (backgroundTasks.length === 0) {
		return;
	}
	const deadline = machineManager.platform.clock.now() + backgroundTaskBudgetMs;
	const iterationsLimit = backgroundTasks.length * 2;
	let iterations = 0;
	while (backgroundTasks.length > 0) {
		const task = backgroundTasks.shift()!;
		const keep = task();
		if (keep) {
			backgroundTasks.push(task);
		}
		iterations += 1;
		if (machineManager.platform.clock.now() >= deadline || iterations >= iterationsLimit) {
			break;
		}
	}
	if (backgroundTasks.length > 0 && backgroundTaskHandle === null) {
		backgroundTaskHandle = scheduleIdeOnce(0, runBackgroundTasks);
	}
}

export function clearBackgroundTasks(): void {
	backgroundTasks.length = 0;
	if (backgroundTaskHandle) {
		backgroundTaskHandle.cancel();
		backgroundTaskHandle = null;
	}
}

export function scheduleIdeOnce(delayMs: number, cb: () => void): TimerHandle {
	return machineManager.platform.clock.scheduleOnce(delayMs, () => cb());
}

export function scheduleRuntimeTask(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
	if (pendingRuntimeTasks === 0) {
		runtimeTaskQueueFailed = false;
	}
	pendingRuntimeTasks += 1;
	machineManager.paused = true;
	scheduleMicrotask(() => {
		runtimeTaskTail = runtimeTaskTail.then(async () => {
			let succeeded = false;
			try {
				await task();
				succeeded = true;
			} catch (error) {
				runtimeTaskQueueFailed = true;
				onError(error);
			} finally {
				pendingRuntimeTasks -= 1;
				if (succeeded && !runtimeTaskQueueFailed && pendingRuntimeTasks === 0) {
					machineManager.paused = false;
				}
			}
		});
	});
}
