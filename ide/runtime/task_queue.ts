import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { MicrotaskQueue } from '../common/microtask_queue';

export class RuntimeTaskQueue {
	private tail = Promise.resolve();
	private pending = 0;
	private failed = false;

	public constructor(
		private readonly microtasks: MicrotaskQueue,
		private readonly audioOutput: HostAudioOutput,
	) {
	}

	public get ready(): boolean {
		return this.pending === 0 && !this.failed;
	}

	public schedule(
		task: () => void | Promise<void>,
		onError: (error: unknown) => void,
	): Promise<void> {
		if (this.pending === 0) {
			this.failed = false;
			this.audioOutput.muteRuntimeTask(true);
		}
		this.pending += 1;
		const scheduled = new Promise<void>((resolve) => {
			this.microtasks.queueMicrotask(resolve);
		});
		this.tail = this.tail.then(async () => {
			await scheduled;
			try {
				await task();
			} catch (error) {
				this.failed = true;
				onError(error);
			} finally {
				this.pending -= 1;
				if (!this.failed && this.pending === 0) {
					this.audioOutput.muteRuntimeTask(false);
				}
			}
		});
		return this.tail;
	}
}
