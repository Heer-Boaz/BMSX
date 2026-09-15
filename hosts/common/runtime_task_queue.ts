import type { HostAudioOutput } from './audio_output';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

export const enum RuntimeTaskKind { Mutation, History }

export class RuntimeTaskQueue {
	private tail = Promise.resolve();
	private pending = 0;
	private mutationPending = 0;
	private failed = false;

	public constructor(
		private readonly audioOutput: HostAudioOutput,
		private readonly presenter: VideoPresenter,
	) {
	}

	public get ready(): boolean {
		return this.pending === 0 && !this.failed;
	}

	/** Background history work defers CPU admission, not the user's next edit intent. */
	public get mutationReady(): boolean {
		return this.mutationPending === 0 && !this.failed;
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
			this.mutationPending += 1;
			this.audioOutput.muteRuntimeTask(true);
		}
		this.pending += 1;
		this.tail = this.tail.then(async () => {
			try {
				if (kind === RuntimeTaskKind.Mutation) {
					await this.presenter.backend.finishGxGpuReadbacks();
				}
				await task();
			} catch (error) {
				this.failed = true;
				this.audioOutput.muteRuntimeTask(true);
				onError(error);
			} finally {
				this.pending -= 1;
				if (muteAudio) this.mutationPending -= 1;
				if (!this.failed && this.mutationPending === 0) {
					this.audioOutput.muteRuntimeTask(false);
				}
			}
		});
		return this.tail;
	}
}
