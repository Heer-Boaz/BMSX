import { ApuOutputMixer } from './devices/audio/output';
import {
	HOST_FAULT_STAGE_NONE,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
} from './bus/io';
import { CPU } from './cpu/cpu';
import { AudioController } from './devices/audio/controller';
import { DmaController } from './devices/dma/controller';
import { GeometryController } from './devices/geometry/controller';
import { GxGpu } from './devices/gx/gpu';
import { GxGte } from './devices/gx/gte';
import { InputController } from './devices/input/controller';
import type { InputControllerInputSource } from './devices/input/contracts';
import { IrqController } from './devices/irq/controller';
import { Memory } from './memory/memory';
import {
	DEVICE_SERVICE_APU,
	DEVICE_SERVICE_DMA,
	DEVICE_SERVICE_GEO,
	DeviceScheduler,
} from './scheduler/device';

export type MachineTiming = {
	cpuHz: number;
	dmaBytesPerSec: number;
	geoWorkUnitsPerSec: number;
};

export class Machine {
	public readonly cpu: CPU;
	public readonly scheduler: DeviceScheduler;
	public readonly irqController: IrqController;
	public readonly dmaController: DmaController;
	public readonly geometryController: GeometryController;
	public readonly gxGpu: GxGpu;
	public readonly gxGte: GxGte;
	public readonly inputController: InputController;
	public readonly audioOutput: ApuOutputMixer;
	public readonly audioController: AudioController;

	public constructor(
		public readonly memory: Memory,
		input: InputControllerInputSource,
	) {
		this.cpu = new CPU(this.memory);
		this.scheduler = new DeviceScheduler(this.cpu);
		this.irqController = new IrqController(this.memory);
		this.audioOutput = new ApuOutputMixer();
		this.audioController = new AudioController(this.memory, this.audioOutput, this.irqController, this.scheduler);
		this.dmaController = new DmaController(this.memory, this.irqController, this.scheduler);
		this.geometryController = new GeometryController(this.memory, this.irqController, this.scheduler);
		this.gxGpu = new GxGpu(this.memory, this.scheduler);
		this.gxGte = new GxGte(this.memory);
		this.inputController = new InputController(this.memory, input);
	}

	public initializeSystemIo(): void {
		this.memory.clearBusFault();
		this.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_NONE);
	}

	public resetDevices(): void {
		this.irqController.reset();
		this.inputController.reset();
		this.dmaController.reset();
		this.geometryController.reset();
		this.gxGpu.reset();
		this.gxGte.reset();
		this.audioController.reset();
	}

	public refreshDeviceTimings(timing: MachineTiming, nowCycles: number): void {
		this.dmaController.setTiming(timing.cpuHz, timing.dmaBytesPerSec, nowCycles);
		this.geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
		this.audioController.setTiming(timing.cpuHz, nowCycles);
	}

	public advanceDevices(cycles: number): void {
		const nextNow = this.scheduler.nowCycles + cycles;
		this.dmaController.accrueCycles(cycles, nextNow);
		this.geometryController.accrueCycles(cycles, nextNow);
		this.audioController.accrueCycles(cycles, nextNow);
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
			case DEVICE_SERVICE_APU:
				this.audioController.onService(nowCycles);
				return;
			default:
				throw new Error(`Runtime fault: unknown device service kind ${deviceKind}.`);
		}
	}

}
