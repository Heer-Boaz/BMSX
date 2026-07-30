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
	): void {
		if (this.pending === 0) {
			this.failed = false;
			this.audioOutput.muteSystem(true);
		}
		this.pending += 1;
		this.microtasks.queueMicrotask(() => {
			this.tail = this.tail.then(async () => {
				try {
					await task();
				} catch (error) {
					this.failed = true;
					onError(error);
				} finally {
					this.pending -= 1;
					if (!this.failed && this.pending === 0) {
						this.audioOutput.muteSystem(false);
					}
				}
			});
		});
	}
}
