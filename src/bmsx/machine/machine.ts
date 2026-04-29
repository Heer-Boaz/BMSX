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
import { IrqController } from './devices/irq/controller';
import type { VdpFrameBufferSize } from './devices/vdp/contracts';
import { VDP, type VdpSaveState, type VdpState } from './devices/vdp/vdp';
import type { Api } from './firmware/api/api';
import { Memory, type MemorySaveState, type MemoryState } from './memory/memory';
import { StringHandleTable, type StringHandleTableState } from './memory/string/memory';
import { StringPool } from './memory/string/pool';
import { ResourceUsageDetector } from './runtime/resource_usage_detector';
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
	memory: MemoryState;
	input: InputControllerState;
	vdp: VdpState;
};

export type MachineSaveState = {
	memory: MemorySaveState;
	stringHandles: StringHandleTableState;
	input: InputControllerState;
	vdp: VdpSaveState;
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
		public readonly frameBufferSize: VdpFrameBufferSize,
		input: Input,
		soundMaster: SoundMaster,
		api: Api,
	) {
		this.stringHandles = new StringHandleTable(this.memory);
		this.stringPool = new StringPool(this.stringHandles);
		this.cpu = new CPU(this.memory, this.stringPool);
		this.scheduler = new DeviceScheduler(this.cpu);
		this.irqController = new IrqController(this.memory);
		this.vdp = new VDP(this.memory, this.cpu, api, this.scheduler, frameBufferSize);
		this.audioController = new AudioController(this.memory, soundMaster, this.irqController);
		this.dmaController = new DmaController(this.memory, this.irqController, this.vdp, this.scheduler);
		this.imgDecController = new ImgDecController(this.memory, this.dmaController, this.vdp, this.irqController, this.scheduler);
		this.geometryController = new GeometryController(this.memory, this.irqController, this.scheduler);
		this.inputController = new InputController(this.memory, input);
		this.resourceUsageDetector = new ResourceUsageDetector(this.stringHandles, this.vdp);
	}

	public initializeSystemIo(): void {
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

	public runDeviceService(deviceKind: number): VDP | null {
		const nowCycles = this.scheduler.nowCycles;
		switch (deviceKind) {
			case DEVICE_SERVICE_GEO:
				this.geometryController.onService(nowCycles);
				return null;
			case DEVICE_SERVICE_DMA:
				this.dmaController.onService(nowCycles);
				return null;
			case DEVICE_SERVICE_IMG:
				this.imgDecController.onService(nowCycles);
				return null;
			case DEVICE_SERVICE_VDP:
				this.vdp.onService(nowCycles);
				return this.vdp;
			default:
			throw new Error(`Runtime fault: unknown device service kind ${deviceKind}.`);
		}
	}

	public captureState(): MachineState {
		return {
			memory: this.memory.captureState(),
			input: this.inputController.captureState(),
			vdp: this.vdp.captureState(),
		};
	}

	public restoreState(state: MachineState): void {
		this.memory.restoreState(state.memory);
		this.geometryController.postLoad();
		this.irqController.postLoad();
		this.inputController.restoreState(state.input);
		this.vdp.restoreState(state.vdp);
	}

	public captureSaveState(): MachineSaveState {
		return {
			memory: this.memory.captureSaveState(),
			stringHandles: this.stringHandles.captureState(),
			input: this.inputController.captureState(),
			vdp: this.vdp.captureSaveState(),
		};
	}

	public restoreSaveState(state: MachineSaveState): void {
		this.memory.restoreSaveState(state.memory);
		this.stringHandles.restoreState(state.stringHandles);
		this.cpu.rehydrateStringPoolFromHandleTable(state.stringHandles);
		this.geometryController.postLoad();
		this.irqController.postLoad();
		this.inputController.restoreState(state.input);
		this.vdp.restoreSaveState(state.vdp);
	}

}
