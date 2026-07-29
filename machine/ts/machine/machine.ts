import { ApuOutputMixer } from './devices/audio/output';
import { CPU } from './cpu/cpu';
import { ExecutionAddressSpace } from './execution_address_space';
import { AudioController } from './devices/audio/controller';
import type { CartridgeController } from './devices/cartridge/controller';
import { DmaController } from './devices/dma/controller';
import { GeometryController } from './devices/geometry/controller';
import { GxGpu } from './devices/gx/gpu';
import { GxGte } from './devices/gx/gte';
import { InputController } from './devices/input/controller';
import type { InputControllerInputSource } from './devices/input/contracts';
import { ImgDecController } from './devices/imgdec/controller';
import { IrqController } from './devices/irq/controller';
import { SystemController } from './devices/system/controller';
import { Memory } from './memory/memory';
import type { MachineModelSpec } from '../spec/bmsx/model';
import {
	DEVICE_SERVICE_APU,
	DEVICE_SERVICE_APU_TRANSFER,
	DEVICE_SERVICE_DMA,
	DEVICE_SERVICE_GEO,
	DEVICE_SERVICE_GPU,
	DEVICE_SERVICE_GTE,
	DEVICE_SERVICE_IMGDEC,
	DEVICE_SERVICE_SYSTEM,
	DeviceScheduler,
} from './scheduler/device';

export type MachineTiming = {
	cpuHz: number;
	geoWorkUnitsPerSec: number;
};

export class Machine {
	public readonly cpu: CPU;
	public readonly executionAddressSpace: ExecutionAddressSpace;
	public readonly scheduler: DeviceScheduler;
	public readonly irqController: IrqController;
	public readonly systemController: SystemController;
	public readonly cartridgeController: CartridgeController;
	public readonly dmaController: DmaController;
	public readonly geometryController: GeometryController;
	public readonly gxGpu: GxGpu;
	public readonly gxGte: GxGte;
	public readonly imgDecController: ImgDecController;
	public readonly inputController: InputController;
	public readonly audioOutput: ApuOutputMixer;
	public readonly audioController: AudioController;

	public constructor(
		public readonly memory: Memory,
		input: InputControllerInputSource,
		model: MachineModelSpec,
	) {
		this.cartridgeController = this.memory.cartridgeController;
		this.irqController = new IrqController(this.memory);
		this.executionAddressSpace = new ExecutionAddressSpace(this.memory);
		this.cpu = new CPU(this.memory, this.irqController, this.executionAddressSpace);
		this.scheduler = new DeviceScheduler(this.cpu);
		this.audioOutput = new ApuOutputMixer();
		this.dmaController = new DmaController(this.memory, this.cpu, this.irqController, this.scheduler);
		this.cartridgeController.connect(this.memory, this.irqController, this.dmaController);
		this.audioController = new AudioController(this.memory, this.audioOutput, this.dmaController, this.irqController, this.scheduler);
		this.geometryController = new GeometryController(this.memory, this.irqController, this.scheduler);
		this.gxGpu = new GxGpu(
			this.memory,
			this.cpu,
			this.irqController,
			this.scheduler,
			this.dmaController,
			model.gxGpuVramBytes,
		);
		this.imgDecController = new ImgDecController(
			this.memory,
			this.cpu,
			this.irqController,
			this.scheduler,
			this.dmaController,
			model.imgDecCyclesPerOutputWord,
		);
		this.gxGte = new GxGte(this.memory, this.cpu, this.scheduler);
		this.systemController = new SystemController(
			this.memory,
			this.cpu,
			this.scheduler,
			this.irqController,
			this.dmaController,
			this.geometryController,
			this.gxGpu,
			this.imgDecController,
			model.cpuFreqHz,
		);
		this.inputController = new InputController(this.memory, input, this.systemController);
		this.dmaController.setTiming(
			model.dmaRamCyclesPerWord,
			model.dmaRamBurstSetupCycles,
			model.dmaSystemRomCyclesPerWord,
			model.dmaCartRomCyclesPerWord,
			model.dmaCartRomBurstSetupCycles,
			this.scheduler.currentNowCycles(),
		);
	}

	public resetDevices(): void {
		this.irqController.reset();
		this.inputController.reset();
		this.dmaController.reset();
		this.cartridgeController.reset();
		this.geometryController.reset();
		this.gxGpu.reset();
		this.imgDecController.reset();
		this.gxGte.reset();
		this.audioController.reset();
		this.systemController.reset();
	}

	public refreshDeviceTimings(timing: MachineTiming, nowCycles: number): void {
		this.systemController.setTiming(timing.cpuHz);
		this.geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
		this.audioController.setTiming(timing.cpuHz, nowCycles);
		this.gxGpu.setTiming(timing.cpuHz, nowCycles);
	}

	public advanceDevices(cycles: number): void {
		const nextNow = this.scheduler.nowCycles + cycles;
		this.geometryController.accrueCycles(cycles, nextNow);
		this.scheduler.advanceTo(nextNow);
	}

	public runDeviceService(deviceKind: number): number {
		const nowCycles = this.scheduler.nowCycles;
		switch (deviceKind) {
			case DEVICE_SERVICE_GEO:
				this.geometryController.onService(nowCycles);
				return 0;
			case DEVICE_SERVICE_DMA:
				this.dmaController.onService(nowCycles);
				return 0;
			case DEVICE_SERVICE_APU:
				this.audioController.onService(nowCycles);
				return 0;
			case DEVICE_SERVICE_APU_TRANSFER:
				this.audioController.onTransferService(nowCycles);
				return 0;
			case DEVICE_SERVICE_GPU:
				return this.gxGpu.onService(nowCycles);
			case DEVICE_SERVICE_GTE:
				this.gxGte.onService();
				return 0;
			case DEVICE_SERVICE_IMGDEC:
				this.imgDecController.onService(nowCycles);
				return 0;
			case DEVICE_SERVICE_SYSTEM:
				this.systemController.onService();
				return 0;
			default:
				throw new Error(`Runtime fault: unknown device service kind ${deviceKind}.`);
		}
	}

}
