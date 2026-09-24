import type { PngImageEncoder, GameImageCapture } from './image';
import type { RenderPresentationState } from './presentation_state';
import { RuntimeTaskKind, type RuntimeTaskQueue } from './runtime_task_queue';
import type { RgbaImage } from '../../machine/ts/render/image';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

/** Captures a renderer-owned frame; never runs the guest or renders a substitute. */
export class GameCaptureService implements GameImageCapture {
	public constructor(
		private readonly presenter: VideoPresenter,
		private readonly presentation: RenderPresentationState,
		private readonly tasks: RuntimeTaskQueue,
		private readonly encode: PngImageEncoder,
	) {}

	public async capture(signal: AbortSignal) {
		signal.throwIfAborted();
		if (!this.tasks.ready) throw new Error('Game capture requires an idle runtime task queue.');
		const sequence = this.presenter.gameFrameSequence;
		if (sequence === undefined || sequence !== this.presentation.gameFrame.presentationSequence) {
			throw new Error('No completed game frame is available.');
		}
		const published = { ...this.presentation.gameFrame, presentationSequence: sequence };
		let image!: RgbaImage;
		let failure: { error: unknown } | undefined;
		// Admission is closed synchronously by schedule. Resets/rewind wait until
		// the GPU copy owns its pixels; PNG encoding needs no machine lock.
		await this.tasks.schedule(async () => {
			if (!signal.aborted) image = await this.presenter.captureGameFrame();
		}, error => { failure = { error }; }, RuntimeTaskKind.History);
		if (failure !== undefined) throw failure.error;
		signal.throwIfAborted();
		const png = await this.encode(image);
		signal.throwIfAborted();
		return { imageUrl: png, published, width: image.width, height: image.height };
	}
}
