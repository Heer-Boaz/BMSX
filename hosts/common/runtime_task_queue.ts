import type { HostAudioOutput } from './audio_output';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

export const enum RuntimeTaskKind { Mutation, History }

export class RuntimeTaskQueue {
	private tail = Promise.resolve();
	private pending = 0;
	private mutationPending = 0;
	public failure: { readonly error: unknown } | undefined;

	public constructor(
		private readonly audioOutput: HostAudioOutput,
		private readonly presenter: VideoPresenter,
	) {
	}

	public get ready(): boolean {
		return this.pending === 0 && this.failure === undefined;
	}

	/** Background history work defers CPU admission, not the user's next edit intent. */
	public get mutationReady(): boolean {
		return this.mutationPending === 0 && this.failure === undefined;
	}

	/** Join already admitted work. The caller must close its own admission first. */
	public join(): Promise<void> { return this.tail; }

	public schedule(
		task: () => void | Promise<void>,
		onError: (error: unknown) => void,
		kind = RuntimeTaskKind.Mutation,
	): Promise<void> {
		const muteAudio = kind === RuntimeTaskKind.Mutation;
		if (this.pending === 0) {
			this.failure = undefined;
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
				this.failure = { error };
				this.audioOutput.muteRuntimeTask(true);
				onError(error);
			} finally {
				this.pending -= 1;
				if (muteAudio) this.mutationPending -= 1;
				if (this.failure === undefined && this.mutationPending === 0) {
					this.audioOutput.muteRuntimeTask(false);
				}
			}
		});
		return this.tail;
	}
}
