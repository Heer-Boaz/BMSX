import type { SoundMaster } from '../audio/soundmaster';
import type { Input } from '../input/input';
import { beginMeshQueue, beginParticleQueue, clearBackQueues } from '../render/shared/render_queues';
import { clearHardwareCamera } from '../render/shared/hardware_camera';
import { clearHardwareLighting } from '../render/shared/hardware_lighting';
import {
	HOST_FAULT_STAGE_NONE,
	IO_SYS_BOOT_CART,
	IO_SYS_CART_BOOTREADY,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
} from './bus/io';
import { CPU } from './cpu/cpu';
import { AudioController } from './devices/audio/audio_controller';
import { DmaController } from './devices/dma/dma_controller';
import { GeometryController } from './devices/geometry/geometry_controller';
import { ImgDecController } from './devices/imgdec/imgdec_controller';
import { InputController, type InputControllerState } from './devices/input/input_controller';
import { IrqController } from './devices/irq/irq_controller';
import { VDP, type VdpBlitterExecutor, type VdpState } from './devices/vdp/vdp';
import { Memory } from './memory/memory';
import { StringHandleTable } from './memory/string_memory';
import { StringPool } from './memory/string_pool';
import { ResourceUsageDetector } from './runtime/resource_usage_detector';
import {
	DEVICE_SERVICE_DMA,
	DEVICE_SERVICE_GEO,
	DEVICE_SERVICE_IMG,
	DEVICE_SERVICE_VDP,
	DeviceScheduler,
} from './scheduler/device_scheduler';

export type MachineTiming = {
	cpuHz: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	imgDecBytesPerSec: number;
	geoWorkUnitsPerSec: number;
	vdpWorkUnitsPerSec: number;
};

export type MachineState = {
	input: InputControllerState;
	vdp: VdpState;
};

export class Machine {
	public readonly stringHandles: StringHandleTable;
	public readonly stringPool: StringPool;
	public readonly cpu: CPU;
	public readonly scheduler: DeviceScheduler;
	public readonly irqController: IrqController;
	public readonly vdp: VDP;
	public readonly dmaController: DmaController;
	public readonly geometryController: GeometryController;
	public readonly imgDecController: ImgDecController;
	public readonly inputController: InputController;
	public readonly audioController: AudioController;
	public readonly resourceUsageDetector: ResourceUsageDetector;

	public constructor(
		public readonly memory: Memory,
		blitterExecutor: VdpBlitterExecutor | null,
		input: Input,
		soundMaster: SoundMaster,
	) {
		this.stringHandles = new StringHandleTable(this.memory);
		this.stringPool = new StringPool(this.stringHandles);
		this.cpu = new CPU(this.memory, this.stringPool);
		this.scheduler = new DeviceScheduler(this.cpu);
		this.irqController = new IrqController(this.memory);
		this.vdp = new VDP(this.memory, blitterExecutor, this.scheduler);
		this.audioController = new AudioController(this.memory, soundMaster, this.irqController);
		this.dmaController = new DmaController(this.memory, this.irqController, this.vdp, this.scheduler);
		this.imgDecController = new ImgDecController(this.memory, this.dmaController, this.irqController, this.scheduler);
		this.geometryController = new GeometryController(this.memory, this.irqController, this.scheduler);
		this.inputController = new InputController(this.memory, input);
		this.resourceUsageDetector = new ResourceUsageDetector(this.memory, this.stringHandles, this.vdp);
	}

	public initializeSystemIo(): void {
		this.memory.writeValue(IO_SYS_BOOT_CART, 0);
		this.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_NONE);
	}

	public resetDevices(): void {
		this.irqController.reset();
		this.inputController.reset();
		this.dmaController.reset();
		this.geometryController.reset();
		this.imgDecController.reset();
		this.audioController.reset();
		this.vdp.initializeRegisters();
	}

	public refreshDeviceTimings(timing: MachineTiming, nowCycles: number): void {
		this.dmaController.setTiming(timing.cpuHz, timing.dmaBytesPerSecIso, timing.dmaBytesPerSecBulk, nowCycles);
		this.imgDecController.setTiming(timing.cpuHz, timing.imgDecBytesPerSec, nowCycles);
		this.geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
		this.vdp.setTiming(timing.cpuHz, timing.vdpWorkUnitsPerSec, nowCycles);
	}

	public advanceDevices(cycles: number): void {
		const nextNow = this.scheduler.nowCycles + cycles;
		this.dmaController.accrueCycles(cycles, nextNow);
		this.imgDecController.accrueCycles(cycles, nextNow);
		this.geometryController.accrueCycles(cycles, nextNow);
		this.vdp.accrueCycles(cycles, nextNow);
		this.scheduler.advanceTo(nextNow);
	}

	public runDeviceService(deviceKind: number): void {
		const nowCycles = this.scheduler.nowCycles;
		switch (deviceKind) {
			case DEVICE_SERVICE_GEO:
				this.geometryController.onService(nowCycles);
				return;
			case DEVICE_SERVICE_DMA:
				this.dmaController.onService(nowCycles);
				return;
			case DEVICE_SERVICE_IMG:
				this.imgDecController.onService(nowCycles);
				return;
			case DEVICE_SERVICE_VDP:
				this.vdp.onService(nowCycles);
				return;
			default:
			throw new Error(`Runtime fault: unknown device service kind ${deviceKind}.`);
		}
	}

	public captureState(): MachineState {
		return {
			input: this.inputController.captureState(),
			vdp: this.vdp.captureState(),
		};
	}

	public restoreState(state: MachineState): void {
		this.inputController.restoreState(state.input);
		this.vdp.restoreState(state.vdp);
		this.vdp.flushAssetEdits();
	}

	public resetRenderBuffers(): void {
		clearHardwareCamera();
		clearHardwareLighting();
		clearBackQueues();
		beginMeshQueue();
		beginParticleQueue();
	}
}
