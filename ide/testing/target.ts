import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeOptions } from '../../machine/ts/machine/runtime/options';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { initializeMachineVideoPresenter } from '../../hosts/common/machine_runtime';
import { OffscreenVideoOutput } from '../../hosts/common/offscreen_video_output';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { TestInput } from './input';

/** One physical test machine. Only immutable media may be shared between cases. */
export class TestTarget {
	public readonly runtime: Runtime;
	public readonly input = new TestInput();
	public readonly presentation = new RenderPresentationState();
	private videoBackend: HeadlessGPUBackend | null = null;
	private videoPresenter: VideoPresenter | null = null;

	public constructor(private readonly options: RuntimeOptions) {
		this.runtime = new Runtime(options, this.input);
		this.runtime.boot();
	}

	public get backend(): HeadlessGPUBackend {
		if (this.videoBackend === null) {
			this.videoBackend = new HeadlessGPUBackend(256, 212, this.options.machineModel.gxGpuVramBytes);
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
		this.input.reset();
		this.runtime.machine.cpu.setExecutionHook(null, 0, 0);
		this.videoPresenter?.dispose();
	}
}
