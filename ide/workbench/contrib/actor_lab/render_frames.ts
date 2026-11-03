import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { GxGpuPresentationObserver } from '../../../../machine/ts/machine/devices/gx/gpu';
import { GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1, type GxGpuPcrtcScanout } from '../../../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { GX_GPU_STATUS_GPU_IDLE } from '../../../../machine/ts/machine/devices/gx/gpu';
import { GX_GPU_VRAM_X_ADDRESS_PERIOD } from '../../../../machine/ts/spec/gx/vram';
import type { GameFrameObserver, VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { RuntimeInstructionObservers } from '../../../runtime/instruction_observers';
import { ActorRenderFrame } from './render_geometry';
import { ActorRenderObservation } from './render_observation';

/** Three lifetimes: submitted page geometry, the device latch, the image actually
 * published by the presenter. Running ahead or repainting a held frame cannot
 * silently replace the displayed image's evidence with current guest positions. */
export class ActorRenderFrames implements GxGpuPresentationObserver, GameFrameObserver {
	public readonly displayed = new ActorRenderFrame();
	private readonly latch = new ActorRenderFrame();
	private latchRevision = 0;
	private displayedRevision = -1;
	private readonly order = { value: 0 };
	private readonly observations: ActorRenderObservation[] = [];
	private readonly releases: (() => void)[] = [];
	private readonly unbindGuest: () => void;
	private releasePresentation: (() => void) | undefined;
	public constructor(private readonly runtime: Runtime, private readonly sources: RuntimeInstalledSourceState,
		private readonly guest: SuspendedGuestSession, private readonly observers: RuntimeInstructionObservers) {
		this.beginExecution();
		runtime.machine.gxGpu.setPresentationObserver(this);
		this.unbindGuest = guest.onDidInvalidate(reason => {
			if (reason === 'heap-replaced') this.beginExecution();
			else if (reason === 'history-restored') this.reset();
		});
	}
	/** Overlay commands are collected before presentation. Do not draw an old
	 * hover outline into a newly latched image which has not committed yet. */
	public get displayCurrent(): boolean { return this.displayedRevision === this.latchRevision; }
	public attach(presenter: VideoPresenter): () => void {
		this.displayed.sequence = undefined; this.displayedRevision = -1;
		presenter.setGameFrameObserver(this);
		return this.releasePresentation = () => {
			presenter.setGameFrameObserver(null); this.displayed.sequence = undefined; this.displayedRevision = -1;
			this.releasePresentation = undefined;
		};
	}
	public beginExecution(): void {
		for (const release of this.releases) release();
		this.releases.length = 0; this.observations.length = 0;
		this.reset();
		for (const domain of [-1, 0, 1] as const) {
			const image = domain === -1 ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image?.symbols == null) continue;
			const observation = new ActorRenderObservation(this.runtime.machine.cpu, image, domain, this.guest, this.order);
			this.observations.push(observation); this.releases.push(this.observers.add(observation));
		}
	}
	private reset(): void {
		this.latchRevision++; this.displayedRevision = -1;
		this.latch.quads.clear(); this.displayed.quads.clear(); this.displayed.sequence = undefined;
		for (const observation of this.observations) observation.reset();
	}
	public latched(statusWord: number, scanout: Readonly<GxGpuPcrtcScanout>, changed: boolean): void {
		if (!changed) return;
		this.latchRevision++;
		this.latch.quads.clear(); this.latch.width = scanout.outputWidth; this.latch.height = scanout.outputHeight;
		// This evidence covers ordinary full-page, linear 2D cartlib output. Mixed
		// circuits, interlaced fields and a partially executed render have no single
		// observed planar composition. They remain viewable, not guessed pickable.
		const circuit = scanout.circuits[0];
		if ((statusWord & GX_GPU_STATUS_GPU_IDLE) === 0 || !scanout.outputActive || scanout.interlaced
			|| scanout.compositionPath !== GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1
			|| circuit.framebufferBaseWord !== 0 || circuit.framebufferWidth !== GX_GPU_VRAM_X_ADDRESS_PERIOD) return;
		let newest = 0;
		for (const observation of this.observations) for (const page of observation.pages) {
			if (page.x !== circuit.framebufferX || page.y !== circuit.linearFieldSourceY || page.order <= newest) continue;
			newest = page.order;
			this.latch.quads.clear();
			if (page.ready) this.latch.copyFrom(page.geometry);
		}
		this.latch.offsetX = circuit.displayX; this.latch.offsetY = circuit.displayY;
	}
	public committed(sequence: number): void {
		this.displayed.copyFrame(this.latch); this.displayed.sequence = sequence; this.displayedRevision = this.latchRevision;
	}
	public dispose(): void {
		this.releasePresentation?.(); this.unbindGuest(); this.runtime.machine.gxGpu.setPresentationObserver(null);
		for (const release of this.releases) release();
		this.releases.length = 0; this.observations.length = 0; this.reset();
	}
}
