import { consoleCore } from '../../core/console';
import { scheduleMicrotask, type TimerHandle } from '../../platform/platform';

export type BackgroundTask = () => boolean;

const backgroundTasks: BackgroundTask[] = [];
let backgroundTaskHandle: TimerHandle = null;
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
	const deadline = consoleCore.platform.clock.now() + backgroundTaskBudgetMs;
	const iterationsLimit = backgroundTasks.length * 2;
	let iterations = 0;
	while (backgroundTasks.length > 0) {
		const task = backgroundTasks.shift()!;
		const keep = task();
		if (keep) {
			backgroundTasks.push(task);
		}
		iterations += 1;
		if (consoleCore.platform.clock.now() >= deadline || iterations >= iterationsLimit) {
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
	return consoleCore.platform.clock.scheduleOnce(delayMs, () => cb());
}

export function scheduleRuntimeTask(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
	scheduleMicrotask(() => {
		try {
			Promise.resolve(task()).catch(onError);
		} catch (error) {
			onError(error);
		}
	});
}
