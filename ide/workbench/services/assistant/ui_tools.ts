import type { RemoteInput } from '../../../../hosts/common/input/remote';
import type { CapturedSurfaceImage } from '../../../../hosts/common/image';
import type { EditorDisplay } from '../../../common/viewport';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { StudioToolInputError } from './tool_input';
import { decodeStudioUiRequest, type StudioUiInputStep } from './ui_tool_protocol';

type Capture = { image: CapturedSurfaceImage; presentation: number };
type CaptureGeometry = { width: number; height: number };
type CaptureWait = { resolve: (capture: Capture) => void; reject: (reason: unknown) => void };
type InputRun = {
	steps: StudioUiInputStep[]; capture: CaptureGeometry; step: number; remaining: number; frames: number;
	resolve: (result: { completedFrames: number }) => void; reject: (reason: unknown) => void;
};

/** One actual host surface. Idle frames do no readback, encoding or event allocation. */
export class StudioUiService {
	private readonly captures = new Set<CaptureWait>();
	private run: InputRun | undefined;
	private lifetime = new AbortController();
	private presentation = 0;
	private readonly unbindWorkspace: () => void;
	public constructor(private readonly readSurface: () => CapturedSurfaceImage,
		private readonly size: { readonly x: number; readonly y: number }, private readonly display: EditorDisplay,
		models: EditorTextModelService, private readonly input?: RemoteInput) {
		this.unbindWorkspace = models.onWillClear(() => {
			this.retire(new Error('Studio workspace replaced. Open a new tool context.'));
			this.lifetime = new AbortController();
		});
	}

	public get canControl(): boolean { return this.input !== undefined; }
	public open(allowInput: boolean): StudioUiContext {
		this.lifetime.signal.throwIfAborted();
		return new StudioUiContext(this, allowInput, this.lifetime.signal);
	}

	public async capture(signal: AbortSignal): Promise<Capture> {
		signal.throwIfAborted();
		const completion = Promise.withResolvers<Capture>();
		const wait = { resolve: completion.resolve, reject: completion.reject };
		const abort = () => { this.captures.delete(wait); completion.reject(signal.reason); };
		this.captures.add(wait);
		signal.addEventListener('abort', abort, { once: true });
		try { return await completion.promise; }
		finally { signal.removeEventListener('abort', abort); }
	}

	public async control(capture: CaptureGeometry, steps: StudioUiInputStep[], signal: AbortSignal): Promise<{ completedFrames: number }> {
		signal.throwIfAborted();
		if (this.input === undefined) throw new StudioToolInputError('This Studio host does not admit remote input.');
		if (this.run !== undefined) throw new StudioToolInputError('Another UI input sequence is still running.');
		// Reject out-of-image coordinates before any effects, not halfway through a drag.
		for (const step of steps) for (const event of step.events) {
			if (event.type === 'pointer' && (event.x >= capture.width || event.y >= capture.height)) {
				throw new StudioToolInputError('Pointer coordinates are outside the captured image.');
			}
		}
		const completion = Promise.withResolvers<{ completedFrames: number }>();
		const run: InputRun = { steps, capture, step: 0, remaining: 0, frames: 0, resolve: completion.resolve, reject: completion.reject };
		this.run = run;
		const abort = () => { if (this.run === run) this.finishInput(signal.reason); };
		signal.addEventListener('abort', abort, { once: true });
		try { return await completion.promise; }
		finally { signal.removeEventListener('abort', abort); }
	}

	/** Called before the host's ordinary input poll, never by a parallel scheduler. */
	public beforeFrame(): void {
		const run = this.run;
		if (run === undefined || run.remaining !== 0) return;
		const step = run.steps[run.step];
		try {
			for (const event of step.events) {
				if (event.type !== 'pointer' && event.type !== 'button' && event.type !== 'wheel') continue;
				const image = run.capture;
				if (image.width !== this.size.x || image.height !== this.size.y) {
					throw new StudioToolInputError('Studio surface resized. Capture again before pointer input.');
				}
				if (event.type === 'pointer') {
					const bounds = this.display.measureDisplay();
					event.x = bounds.left + event.x * bounds.width / image.width;
					event.y = bounds.top + event.y * bounds.height / image.height;
				}
			}
			this.input!.apply(step.events);
			run.remaining = step.frames;
		} catch (error) { this.finishInput(error); }
	}

	/** Immediately after presentation, while the browser drawing buffer is still valid. */
	public afterFrame(presentation: number): void {
		const run = this.run;
		if (run !== undefined && run.remaining !== 0) {
			run.frames++;
			if (--run.remaining === 0 && ++run.step === run.steps.length) this.finishInput();
		}
		if (presentation === this.presentation) return;
		this.presentation = presentation;
		if (this.captures.size === 0) return;
		try {
			const capture = { image: this.readSurface(), presentation };
			for (const wait of this.captures) wait.resolve(capture);
		} catch (error) { for (const wait of this.captures) wait.reject(error); }
		this.captures.clear();
	}

	private finishInput(error?: unknown): void {
		const run = this.run;
		if (run === undefined) return;
		this.run = undefined;
		this.input!.release();
		if (error === undefined) run.resolve({ completedFrames: run.frames });
		else run.reject(error);
	}

	private retire(reason: Error): void {
		this.lifetime.abort(reason);
		this.finishInput(reason);
		for (const wait of this.captures) wait.reject(reason);
		this.captures.clear();
	}
	public dispose(): void { this.unbindWorkspace(); this.retire(new Error('Studio UI closed.')); }
}

/** Receipts retain only the latest image geometry, not an unbounded screenshot history. */
export class StudioUiContext {
	private capture: (CaptureGeometry & { receipt: string }) | undefined;
	public constructor(private readonly ui: StudioUiService, private readonly allowInput: boolean, private readonly lifetime: AbortSignal) {}
	public async execute(name: string, input: unknown, signal: AbortSignal) {
		const request = decodeStudioUiRequest(name, input);
		const deadline = AbortSignal.any([signal, this.lifetime, AbortSignal.timeout(15000)]);
		deadline.throwIfAborted();
		if (request.name === 'studio_capture_ui') {
			const capture = await this.ui.capture(deadline);
			deadline.throwIfAborted();
			const receipt = crypto.randomUUID();
			this.capture = { width: capture.image.width, height: capture.image.height, receipt };
			return { kind: 'image' as const, data: { capture: receipt, width: capture.image.width, height: capture.image.height,
				presentation: capture.presentation, inputAllowed: this.allowInput && this.ui.canControl }, images: [capture.image.imageUrl] };
		}
		if (!this.allowInput) throw new StudioToolInputError('UI input requires sourceAccess=edit and reviewApproval=agent; it cannot bypass user review.');
		if (this.capture === undefined || request.capture !== this.capture.receipt) throw new StudioToolInputError('Use this context\'s latest UI capture receipt.');
		return { kind: 'input' as const, data: await this.ui.control(this.capture, request.steps, deadline) };
	}
}
