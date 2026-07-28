import type { SoundMaster } from '../../machine/ts/audio/soundmaster';
import { runGate } from '../../machine/ts/common/taskgate';
import {
	scheduleMicrotask,
	type HostClock,
} from '../../machine/ts/platform/platform';

export type BackgroundTask = () => boolean;

const backgroundTasks: BackgroundTask[] = [];
let runtimeTaskTail = Promise.resolve();
let pendingRuntimeTasks = 0;
let runtimeTaskQueueFailed = false;
const backgroundTaskBudgetMs = 2.0;
const RUNTIME_TASK_CATEGORY = 'ide-runtime-task';
const RUNTIME_TASK_FAILURE_CATEGORY = 'ide-runtime-task-failure';
const RUNTIME_TASK_AUDIO_SUSPENSION = 'runtime-task';

export function enqueueBackgroundTask(task: BackgroundTask): void {
	backgroundTasks.push(task);
}

export function runBackgroundTasks(clock: HostClock): void {
	if (backgroundTasks.length === 0) {
		return;
	}
	const deadline = clock.now() + backgroundTaskBudgetMs;
	const iterationsLimit = backgroundTasks.length * 2;
	let iterations = 0;
	while (backgroundTasks.length > 0) {
		const task = backgroundTasks.shift()!;
		const keep = task();
		if (keep) {
			backgroundTasks.push(task);
		}
		iterations += 1;
		if (clock.now() >= deadline || iterations >= iterationsLimit) {
			break;
		}
	}
}

export function clearBackgroundTasks(): void {
	backgroundTasks.length = 0;
}

export function scheduleRuntimeTask(
	soundMaster: SoundMaster,
	task: () => void | Promise<void>,
	onError: (error: unknown) => void,
): void {
	if (pendingRuntimeTasks === 0) {
		runGate.endCategory(RUNTIME_TASK_FAILURE_CATEGORY);
		runtimeTaskQueueFailed = false;
		soundMaster.suspendAll(RUNTIME_TASK_AUDIO_SUSPENSION);
	}
	pendingRuntimeTasks += 1;
	const token = runGate.begin({
		blocking: true,
		category: RUNTIME_TASK_CATEGORY,
		tag: RUNTIME_TASK_CATEGORY,
	});
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
				runGate.end(token);
				if (succeeded && !runtimeTaskQueueFailed && pendingRuntimeTasks === 0) {
					soundMaster.resumeAll(RUNTIME_TASK_AUDIO_SUSPENSION);
				} else if (runtimeTaskQueueFailed && pendingRuntimeTasks === 0) {
					runGate.begin({
						blocking: true,
						category: RUNTIME_TASK_FAILURE_CATEGORY,
						tag: RUNTIME_TASK_FAILURE_CATEGORY,
					});
				}
			}
		});
	});
}
