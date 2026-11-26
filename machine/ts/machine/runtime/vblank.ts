import { IRQ_VBLANK } from '../../spec/bmsx/io';
import { HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET } from '../../spec/bmsx/heap_service';
import {
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END,
} from '../devices/gx/gpu_pcrtc';
import type { FrameState } from './frame/state';
import { Runtime } from './runtime';

export class VblankState {
	private vblankSequence = 0;
	private lastCompletedVblankSequence = 0;
	private activeTickCompleted = false;

	constructor(private readonly runtime: Runtime) {
	}

	public get tickCompleted(): boolean {
		return this.activeTickCompleted;
	}

	private get deferredPressureAddress(): number {
		return this.runtime.machine.cpu.heapAllocator.managementOffset() + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET;
	}

	public hasDeferredPressure(): boolean {
		return this.runtime.machine.memory.readRamRecordWord(this.deferredPressureAddress) !== 0;
	}

	/** Scheduler admission after a settled clock grant and a coherent heap. */
	public stepDeferredPressure(): boolean {
		const { cpu, memory } = this.runtime.machine;
		const address = this.deferredPressureAddress;
		const pending = memory.readRamRecordWord(address);
		if (pending === 0) return false;
		cpu.gc.assistPhysicalPressureAtTick();
		memory.writeRamRecordWord(address, pending - 1);
		return true;
	}

	public reset(): void {
		const runtime = this.runtime;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
		runtime.machine.inputController.cancelSampleArm();
		runtime.machine.irqController.postLoad();
		runtime.machine.memory.writeRamRecordWord(this.deferredPressureAddress, 0);
	}

	public prepareRestore(): void {
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
	}

	public beginTick(): void {
		this.activeTickCompleted = false;
	}

	public abandonTick(): void {
		this.activeTickCompleted = false;
	}

	public handleGpuRuntimeEdge(edge: number): void {
		if (edge === GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) {
			this.enterVblank();
			return;
		}
		if (edge === GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END) {
			return;
		}
	}

	private enterVblank(): void {
		const runtime = this.runtime;
		this.vblankSequence += 1;
		runtime.machine.gxGpu.presentReadyFrameOnVblankEdge();
		runtime.machine.inputController.onVblankEdge(
			runtime.machine.scheduler.nowCycles,
		);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		if (runtime.frameLoop.frameActive) {
			this.completeTickIfPending(runtime.frameLoop.frameState, this.vblankSequence);
		}
	}

	private completeTickIfPending(frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) return;
		this.activeTickCompleted = true;
		const runtime = this.runtime;
		runtime.frameScheduler.enqueueTickCompletion(frameState);
		this.lastCompletedVblankSequence = vblankSequence;
		const { cpu, memory } = runtime.machine;
		const address = this.deferredPressureAddress;
		const pending = memory.readRamRecordWord(address);
		// A service can stop between allocator writes. Keep one legacy
		// pressure opportunity per tick, not a sample of the torn arena.
		if (cpu.heapServiceActive() || pending !== 0) {
			// As at the immediate assist, an explicit full epoch owns this edge.
			if (cpu.gc.fullEpochs() === 0) memory.writeRamRecordWord(address, pending + 1);
		} else cpu.gc.assistPhysicalPressureAtTick();
	}
}
