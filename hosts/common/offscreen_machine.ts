import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { InputControllerInputSource } from '../../machine/ts/machine/devices/input/contracts';
import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { cartridgeMediaFromImages } from './cartridge_media';
import { initializeMachineVideoPresenter } from './machine_runtime';
import { OffscreenVideoOutput } from './offscreen_video_output';
import { RenderPresentationState } from './presentation_state';

/** Owns an independently clocked machine and its lazy offscreen output, with no test or UI policy. */
export class OffscreenMachine<TInput extends InputControllerInputSource> {
	public readonly runtime: Runtime;
	private readonly presentation = new RenderPresentationState();
	private videoBackend: HeadlessGPUBackend | null = null;
	private videoPresenter: VideoPresenter | null = null;

	public constructor(
		systemRom: Uint8Array,
		cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
		machineModel: MachineModelSpec,
		public readonly input: TInput,
	) {
		this.runtime = new Runtime({ systemRomBytes: systemRom, cartridgeSlots: cartridgeMediaFromImages(cartridgeSlots), machineModel }, input);
		this.runtime.boot();
	}

	public get backend(): HeadlessGPUBackend {
		if (this.videoBackend === null) {
			this.videoBackend = new HeadlessGPUBackend(256, 212, this.runtime.model.gxGpuVramBytes);
		}
		return this.videoBackend;
	}

	public get presenter(): VideoPresenter {
		if (this.videoPresenter === null) {
			this.videoPresenter = initializeMachineVideoPresenter(this.runtime, new OffscreenVideoOutput(256, 212), this.backend);
			this.videoPresenter.crt_postprocessing_enabled = false;
		}
		return this.videoPresenter;
	}

	public serviceBackend(): void {
		const gpu = this.runtime.machine.gxGpu;
		if (gpu.backendCommandDrainPending()) this.backend.executeGxGpuCommandDrain(gpu);
		else if (gpu.backendServicePending()) this.backend.executeGxGpuReadback(gpu);
	}

	public advanceGame(cycles: number): boolean {
		const runtime = this.runtime;
		this.serviceBackend();
		const before = runtime.frameScheduler.lastTickSequence;
		const completed = runtime.frameScheduler.runScheduledToNextLogicalTick(cycles / runtime.timing.cpuCyclesPerMillisecond);
		this.serviceBackend();
		this.presentation.syncAfterRuntimeUpdate(runtime, before);
		runtime.machine.audioController.synchronizeOutput().clear();
		return completed;
	}

	public present(): boolean {
		if (!this.presentation.pending || this.runtime.machine.gxGpu.backendServiceBlocksMachine()) return false;
		const runtime = this.runtime;
		this.serviceBackend();
		return this.presentation.presentPending(this.presenter, runtime, runtime.machine.scheduler.nowCycles / runtime.timing.cpuCyclesPerMillisecond, 0);
	}

	public dispose(): void {
		this.runtime.machine.cpu.setExecutionHook(null, 0, 0);
		this.videoPresenter?.dispose();
	}
}
