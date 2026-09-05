import type { HostAudioOutput } from './audio_output';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

export const enum RuntimeTaskKind { Mutation, History }

export class RuntimeTaskQueue {
	private tail = Promise.resolve();
	private pending = 0;
	private mutedPending = 0;
	private failed = false;

	public constructor(
		private readonly audioOutput: HostAudioOutput,
		private readonly runtime: Runtime,
		private readonly presenter: VideoPresenter,
	) {
	}

	public get ready(): boolean {
		return this.pending === 0 && !this.failed;
	}

	public schedule(
		task: () => void | Promise<void>,
		onError: (error: unknown) => void,
		kind = RuntimeTaskKind.Mutation,
	): Promise<void> {
		const muteAudio = kind === RuntimeTaskKind.Mutation;
		if (this.pending === 0) {
			this.failed = false;
		}
		if (muteAudio) {
			this.mutedPending += 1;
			this.audioOutput.muteRuntimeTask(true);
		}
		this.pending += 1;
		this.tail = this.tail.then(async () => {
			try {
				if (kind === RuntimeTaskKind.Mutation) {
					await this.presenter.backend.captureGxGpuVramSnapshot(this.runtime.machine.gxGpu);
					this.runtime.history.stop();
				}
				await task();
			} catch (error) {
				this.failed = true;
				this.audioOutput.muteRuntimeTask(true);
				onError(error);
			} finally {
				this.pending -= 1;
				if (muteAudio) this.mutedPending -= 1;
				if (!this.failed && this.mutedPending === 0) {
					this.audioOutput.muteRuntimeTask(false);
				}
			}
		});
		return this.tail;
	}
}
