import type { SoundMaster } from '../audio/soundmaster';
import type { Input } from '../input/manager';
import {
	HOST_FAULT_STAGE_NONE,
	IO_SYS_BOOT_CART,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
} from './bus/io';
import { CPU } from './cpu/cpu';
import { AudioController } from './devices/audio/controller';
import { DmaController } from './devices/dma/controller';
import { GeometryController } from './devices/geometry/controller';
import { ImgDecController } from './devices/imgdec/controller';
import { InputController, type InputControllerState } from './devices/input/controller';
import { IrqController, type IrqControllerState } from './devices/irq/controller';
import type { VdpFrameBufferSize } from './devices/vdp/contracts';
import { VDP, type VdpSaveState, type VdpState } from './devices/vdp/vdp';
import { Memory, type MemorySaveState } from './memory/memory';
import type { StringPoolState } from './cpu/string_pool';
import {
	DEVICE_SERVICE_DMA,
	DEVICE_SERVICE_GEO,
	DEVICE_SERVICE_IMG,
	DEVICE_SERVICE_VDP,
	DeviceScheduler,
} from './scheduler/device';

export type MachineTiming = {
	cpuHz: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	imgDecBytesPerSec: number;
	geoWorkUnitsPerSec: number;
	vdpWorkUnitsPerSec: number;
};

export type MachineState = {
	irq: IrqControllerState;
	input: InputControllerState;
	vdp: VdpState;
};

export type MachineSaveState = {
	memory: MemorySaveState;
	irq: IrqControllerState;
	stringPool: StringPoolState;
	input: InputControllerState;
	vdp: VdpSaveState;
};

export class Machine {
	public readonly cpu: CPU;
	public readonly scheduler: DeviceScheduler;
	public readonly irqController: IrqController;
	public readonly vdp: VDP;
	public readonly dmaController: DmaController;
	public readonly geometryController: GeometryController;
	public readonly imgDecController: ImgDecController;
	public readonly inputController: InputController;
	public readonly audioController: AudioController;

	public constructor(
		public readonly memory: Memory,
		public readonly frameBufferSize: VdpFrameBufferSize,
		input: Input,
		soundMaster: SoundMaster,
	) {
		this.cpu = new CPU(this.memory);
		this.scheduler = new DeviceScheduler(this.cpu);
		this.irqController = new IrqController(this.memory);
		this.vdp = new VDP(this.memory, this.scheduler, frameBufferSize);
		this.audioController = new AudioController(this.memory, soundMaster, this.irqController);
		this.dmaController = new DmaController(this.memory, this.irqController, this.vdp, this.scheduler);
		this.imgDecController = new ImgDecController(this.memory, this.dmaController, this.vdp, this.irqController, this.scheduler);
		this.geometryController = new GeometryController(this.memory, this.irqController, this.scheduler);
		this.inputController = new InputController(this.memory, input, this.cpu.stringPool);
	}

	public initializeSystemIo(): void {
		this.memory.clearBusFault();
		this.memory.writeValue(IO_SYS_BOOT_CART, 0);
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
			irq: this.irqController.captureState(),
			input: this.inputController.captureState(),
			vdp: this.vdp.captureState(),
		};
	}

	public restoreState(state: MachineState): void {
		this.geometryController.postLoad();
		this.irqController.restoreState(state.irq);
		this.inputController.restoreState(state.input);
		this.vdp.restoreState(state.vdp);
	}

	public captureSaveState(): MachineSaveState {
		return {
			memory: this.memory.captureSaveState(),
			irq: this.irqController.captureState(),
			stringPool: this.cpu.stringPool.captureState(),
			input: this.inputController.captureState(),
			vdp: this.vdp.captureSaveState(),
		};
	}

	public restoreSaveState(state: MachineSaveState): void {
		this.memory.restoreSaveState(state.memory);
		this.cpu.stringPool.restoreState(state.stringPool);
		this.geometryController.postLoad();
		this.irqController.restoreState(state.irq);
		this.inputController.restoreState(state.input);
		this.vdp.restoreSaveState(state.vdp);
	}

}
