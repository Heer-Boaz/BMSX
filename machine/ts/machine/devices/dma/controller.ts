import {
	DMA_BURST_WORD_CAPACITY,
	DMA_CONTROL_ROUTE_MASK,
	DMA_CONTROL_READ_SLOT_SHIFT,
	DMA_CONTROL_WRITE_SLOT_SHIFT,
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	DMA_TRIGGER_STOP,
	IO_DMA_CHANNEL_COUNT,
	IO_DMA_CONTROLS,
	IO_DMA_READ_ADDRS,
	IO_DMA_STATUSES,
	IO_DMA_TRANSFER_COUNTS,
	IO_DMA_TRIGGERS,
	IO_DMA_WRITE_ADDRS,
	IO_DMA1_READ_ADDR,
	IO_GX_GPU_GP0,
	IO_APU_TRANSFER_DATA,
	IO_IMGDEC_DATA,
	IRQ_DMA0_DONE,
	IRQ_DMA1_DONE,
} from '../../../spec/bmsx/io';
import type { CPU } from '../../cpu/cpu';
import { CART_MMIO_BASE, CART_MMIO_END, IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import { DmaEndpoint } from './endpoints';
import {
	MAPPED_BUS_MASTER_DMA,
	MAPPED_BUS_DMA_MEMORY,
	mappedBusSignalsForCartridgeSlot,
} from '../../memory/bus_signals';
import { IoWriteStorage, Memory, MemoryRegionKind } from '../../memory/memory';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
import type { IrqController } from '../irq/controller';
import type { GxGpu } from '../gx/gpu';
import {
	DmaRegisterFile,
	type DmaChannelStates,
} from './registers';

const DMA_CHANNEL_NONE = IO_DMA_CHANNEL_COUNT;
const READ_ENDPOINTS = [
	DmaEndpoint.Memory, DmaEndpoint.Memory, DmaEndpoint.GpuRead, DmaEndpoint.Memory,
	DmaEndpoint.ImgDecRead, DmaEndpoint.ImgDecRead, DmaEndpoint.Memory, DmaEndpoint.ApuRead,
] as const;
const WRITE_ENDPOINTS = [
	DmaEndpoint.Memory, DmaEndpoint.GpuWrite, DmaEndpoint.Memory, DmaEndpoint.ImgDecWrite,
	DmaEndpoint.Memory, DmaEndpoint.GpuWrite, DmaEndpoint.ApuWrite, DmaEndpoint.Memory,
] as const;
const ENDPOINT_ADDRESSES: readonly number[] = [
	IO_GX_GPU_GP0, IO_GX_GPU_GP0, IO_APU_TRANSFER_DATA, IO_APU_TRANSFER_DATA,
	IO_IMGDEC_DATA, IO_IMGDEC_DATA,
];

export type DmaControllerState = {
	channels: DmaChannelStates;
	activeChannel: number;
	nextChannel: number;
	scheduledBlockWords: number;
	scheduledBlockCycles: number;
	supervisorQuiesceRequested: boolean;
	supervisorAdmissionQuiesceRequested: boolean;
	userChannels: DmaChannelStates;
	userNextChannel: number;
};

export class DmaController {
	private gpu!: GxGpu;
	private ramCyclesPerWord = 1;
	private ramBurstSetupCycles = 0;
	private systemRomCyclesPerWord = 1;
	private cartRomCyclesPerWord = 1;
	private cartRomBurstSetupCycles = 0;
	private activeChannel = DMA_CHANNEL_NONE;
	private nextChannel = 0;
	private scheduledBlockWords = 0;
	private serviceDeadline = 0;
	private readonly endpointCapacity = new Uint32Array(DmaEndpoint.Memory + 1);
	private serviceActive = false;
	private restorePending = false;
	private supervisorQuiesceRequested = false;
	private supervisorAdmissionQuiesceRequested = false;
	private readonly registers = new DmaRegisterFile();
	private readonly userRegisters = new DmaRegisterFile();
	private userNextChannel = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.endpointCapacity[DmaEndpoint.Memory] = DMA_BURST_WORD_CAPACITY;
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			this.memory.mapIoWrite(IO_DMA_CONTROLS[channel]!, this, DmaController.channelConfigWriteThunk, IoWriteStorage.Device);
			this.memory.mapIoWrite(IO_DMA_READ_ADDRS[channel]!, this, DmaController.channelConfigWriteThunk, IoWriteStorage.Device);
			this.memory.mapIoWrite(IO_DMA_WRITE_ADDRS[channel]!, this, DmaController.channelConfigWriteThunk, IoWriteStorage.Device);
			this.memory.mapIoWrite(IO_DMA_TRANSFER_COUNTS[channel]!, this, DmaController.channelConfigWriteThunk, IoWriteStorage.Device);
			this.memory.mapIoWrite(IO_DMA_TRIGGERS[channel]!, this, DmaController.triggerWriteThunk, IoWriteStorage.Device);
		}
	}

	private static channelConfigWriteThunk(context: DmaController, address: number, value: number): void {
		const channel = address >= IO_DMA1_READ_ADDR ? 1 : 0;
		if (context.busy(channel)) {
			return;
		}
		context.memory.writeIoU32(address, value);
		const registers = context.registers.channels[channel];
		if (address === IO_DMA_READ_ADDRS[channel]) {
			registers.readAddressWord = value;
		} else if (address === IO_DMA_WRITE_ADDRS[channel]) {
			registers.writeAddressWord = value;
		} else if (address === IO_DMA_CONTROLS[channel]) {
			registers.controlWord = value;
		} else {
			registers.transferCountWord = value;
		}
	}

	private static triggerWriteThunk(context: DmaController, address: number, value: number): void {
		const channel = address === IO_DMA_TRIGGERS[1] ? 1 : 0;
		if (context.supervisorQuiesceRequested || context.activeChannel === channel) {
			return;
		}
		if ((value & DMA_TRIGGER_STOP) !== 0) {
			context.finishChannel(channel, 0);
			context.arbitrate(context.scheduler.currentNowCycles());
			return;
		}
		if ((value & DMA_TRIGGER_START) === 0 || context.busy(channel)) {
			return;
		}
		const registers = context.registers.channels[channel]!;
		const route = registers.controlWord & DMA_CONTROL_ROUTE_MASK;
		const gpuJob = registers.transferCountWord !== 0 && (READ_ENDPOINTS[route] === DmaEndpoint.GpuRead || WRITE_ENDPOINTS[route] === DmaEndpoint.GpuWrite);
		if (gpuJob) context.gpu.synchronizeDmaStart();
		registers.statusWord = DMA_STATUS_BUSY;
		context.memory.writeIoU32(IO_DMA_STATUSES[channel]!, DMA_STATUS_BUSY);
		if (gpuJob) context.gpu.dmaRequestStarted();
		if (registers.transferCountWord === 0) {
			context.finishChannel(channel);
		}
		context.arbitrate(context.scheduler.currentNowCycles());
	}

	public connectGpu(gpu: GxGpu): void {
		this.gpu = gpu;
	}

	public setTiming(
		ramCyclesPerWord: number,
		ramBurstSetupCycles: number,
		systemRomCyclesPerWord: number,
		cartRomCyclesPerWord: number,
		cartRomBurstSetupCycles: number,
		nowCycles: number,
	): void {
		if (this.ramCyclesPerWord === ramCyclesPerWord
			&& this.ramBurstSetupCycles === ramBurstSetupCycles
			&& this.systemRomCyclesPerWord === systemRomCyclesPerWord
			&& this.cartRomCyclesPerWord === cartRomCyclesPerWord
			&& this.cartRomBurstSetupCycles === cartRomBurstSetupCycles) {
			return;
		}
		this.ramCyclesPerWord = ramCyclesPerWord;
		this.ramBurstSetupCycles = ramBurstSetupCycles;
		this.systemRomCyclesPerWord = systemRomCyclesPerWord;
		this.cartRomCyclesPerWord = cartRomCyclesPerWord;
		this.cartRomBurstSetupCycles = cartRomBurstSetupCycles;
		if (this.activeChannel === DMA_CHANNEL_NONE) {
			this.arbitrate(nowCycles);
		}
	}

	public setEndpointCapacity(endpoint: DmaEndpoint, words: number): void {
		if (this.endpointCapacity[endpoint] === words) return;
		this.endpointCapacity[endpoint] = words;
		this.arbitrate(this.scheduler.currentNowCycles());
	}

	public setEndpointRequests(first: DmaEndpoint, firstWords: number, second: DmaEndpoint, secondWords: number): void {
		if (this.endpointCapacity[first] === firstWords && this.endpointCapacity[second] === secondWords) return;
		this.endpointCapacity[first] = firstWords;
		this.endpointCapacity[second] = secondWords;
		this.arbitrate(this.scheduler.currentNowCycles());
	}

	public cpuBusHeld(): boolean {
		return this.activeChannel !== DMA_CHANNEL_NONE;
	}

	public ownsReadPort(address: number): boolean {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; ++channel) {
			const registers = this.registers.channels[channel];
			const endpoint = READ_ENDPOINTS[registers.controlWord & DMA_CONTROL_ROUTE_MASK];
			if ((registers.statusWord & DMA_STATUS_BUSY) !== 0 && endpoint !== DmaEndpoint.Memory
				&& ENDPOINT_ADDRESSES[endpoint] === address) return true;
		}
		return false;
	}

	public ownsWritePort(address: number): boolean {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; ++channel) {
			const registers = this.registers.channels[channel];
			const endpoint = WRITE_ENDPOINTS[registers.controlWord & DMA_CONTROL_ROUTE_MASK];
			if ((registers.statusWord & DMA_STATUS_BUSY) !== 0 && endpoint !== DmaEndpoint.Memory
				&& ENDPOINT_ADDRESSES[endpoint] === address) return true;
		}
		return false;
	}

	public hasAdmittedWriteBlock(address: number): boolean {
		if (this.activeChannel === DMA_CHANNEL_NONE) return false;
		const endpoint = WRITE_ENDPOINTS[this.registers.channels[this.activeChannel].controlWord & DMA_CONTROL_ROUTE_MASK];
		return endpoint !== DmaEndpoint.Memory && ENDPOINT_ADDRESSES[endpoint] === address;
	}

	public reset(): void {
		this.clearLiveTransfer();
		this.endpointCapacity.fill(0);
		this.endpointCapacity[DmaEndpoint.Memory] = DMA_BURST_WORD_CAPACITY;
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
		this.clearUserContext();
	}

	public onService(_nowCycles: number): void {
		const channel = this.activeChannel;
		const registers = this.registers.channels[channel];
		const control = registers.controlWord;
		const route = control & DMA_CONTROL_ROUTE_MASK;
		const readEndpoint = READ_ENDPOINTS[route];
		const writeEndpoint = WRITE_ENDPOINTS[route];
		const readStep = readEndpoint === DmaEndpoint.Memory ? IO_WORD_SIZE : 0;
		const writeStep = writeEndpoint === DmaEndpoint.Memory ? IO_WORD_SIZE : 0;
		const readAddress = readStep !== 0 ? registers.readAddressWord : ENDPOINT_ADDRESSES[readEndpoint];
		const writeAddress = writeStep !== 0 ? registers.writeAddressWord : ENDPOINT_ADDRESSES[writeEndpoint];
		const readSignals = MAPPED_BUS_MASTER_DMA | (readStep !== 0 ? MAPPED_BUS_DMA_MEMORY
			| mappedBusSignalsForCartridgeSlot((control >>> DMA_CONTROL_READ_SLOT_SHIFT) & 1) : 0);
		const writeSignals = MAPPED_BUS_MASTER_DMA | (writeStep !== 0 ? MAPPED_BUS_DMA_MEMORY
			| mappedBusSignalsForCartridgeSlot((control >>> DMA_CONTROL_WRITE_SLOT_SHIFT) & 1) : 0);
		const words = this.scheduledBlockWords;
		const previousDeadline = this.serviceDeadline;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.serviceActive = true;
		this.memory.transferDmaBlock(readAddress, writeAddress, words, readStep, writeStep, readSignals, writeSignals);
		registers.readAddressWord = (registers.readAddressWord + words * readStep) >>> 0;
		registers.writeAddressWord = (registers.writeAddressWord + words * writeStep) >>> 0;
		registers.transferCountWord = (registers.transferCountWord - words) >>> 0;
		this.memory.writeIoU32(IO_DMA_READ_ADDRS[channel], registers.readAddressWord);
		this.memory.writeIoU32(IO_DMA_WRITE_ADDRS[channel], registers.writeAddressWord);
		this.memory.writeIoU32(IO_DMA_TRANSFER_COUNTS[channel], registers.transferCountWord);
		this.serviceActive = false;
		this.clearAdmittedBlock();
		if (registers.transferCountWord === 0) {
			this.finishChannel(channel);
		}
		this.arbitrate(previousDeadline);
	}

	public captureState(): DmaControllerState {
		return {
			channels: this.registers.captureChannels(),
			activeChannel: this.activeChannel,
			nextChannel: this.nextChannel,
			scheduledBlockWords: this.scheduledBlockWords,
			scheduledBlockCycles: this.scheduledBlockWords === 0
				? 0
				: this.serviceDeadline - this.scheduler.currentNowCycles(),
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			supervisorAdmissionQuiesceRequested: this.supervisorAdmissionQuiesceRequested,
			userChannels: this.userRegisters.captureChannels(),
			userNextChannel: this.userNextChannel,
		};
	}

	public restoreState(state: DmaControllerState, nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.registers.copyChannels(state.channels);
		this.registers.mirror(this.memory);
		this.activeChannel = state.activeChannel;
		this.nextChannel = state.nextChannel;
		this.scheduledBlockWords = state.scheduledBlockWords;
		this.serviceDeadline = nowCycles + state.scheduledBlockCycles;
		this.serviceActive = false;
		this.restorePending = true;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.supervisorAdmissionQuiesceRequested = state.supervisorAdmissionQuiesceRequested;
		this.userRegisters.copyChannels(state.userChannels);
		this.userNextChannel = state.userNextChannel;
	}

	public postLoad(): void {
		this.restorePending = false;
		if (this.activeChannel !== DMA_CHANNEL_NONE) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
		} else {
			this.arbitrate(this.scheduler.currentNowCycles());
		}
	}

	public beginSupervisorControlQuiesce(): void {
		this.supervisorQuiesceRequested = true;
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.supervisorAdmissionQuiesceRequested = true;
		this.notifySupervisorBoundary();
	}

	public supervisorQuiescent(): boolean {
		return this.supervisorAdmissionQuiesceRequested
			&& this.activeChannel === DMA_CHANNEL_NONE
			&& !this.serviceActive;
	}

	public enterSupervisorContext(): void {
		this.userRegisters.copyChannels(this.registers.channels);
		this.userNextChannel = this.nextChannel;
		this.clearLiveTransfer();
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
	}

	public leaveSupervisorContext(): void {
		this.clearLiveTransfer();
		this.registers.copyChannels(this.userRegisters.channels);
		this.registers.mirror(this.memory);
		this.nextChannel = this.userNextChannel;
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
		this.clearUserContext();
		this.arbitrate(this.scheduler.currentNowCycles());
	}

	private clearLiveTransfer(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.clearAdmittedBlock();
		this.nextChannel = 0;
		this.serviceActive = false;
		this.restorePending = false;
		this.registers.clear();
		this.registers.mirror(this.memory);
	}

	private clearUserContext(): void {
		this.userRegisters.clear();
		this.userNextChannel = 0;
	}

	private clearAdmittedBlock(): void {
		this.activeChannel = DMA_CHANNEL_NONE;
		this.scheduledBlockWords = 0;
		this.serviceDeadline = 0;
	}

	private finishChannel(channel: number, status = DMA_STATUS_DONE): void {
		const registers = this.registers.channels[channel];
		const route = registers.controlWord & DMA_CONTROL_ROUTE_MASK;
		registers.statusWord = status;
		this.memory.writeIoU32(IO_DMA_STATUSES[channel], status);
		if ((status & DMA_STATUS_DONE) !== 0) this.irq.raise(channel === 0 ? IRQ_DMA0_DONE : IRQ_DMA1_DONE);
		const read = READ_ENDPOINTS[route], write = WRITE_ENDPOINTS[route];
		if (read !== DmaEndpoint.Memory) this.resumeCpuWriteIfPortReleased(ENDPOINT_ADDRESSES[read]);
		if (write !== DmaEndpoint.Memory) this.resumeCpuWriteIfPortReleased(ENDPOINT_ADDRESSES[write]);
	}

	private resumeCpuWriteIfPortReleased(address: number): void {
		if (this.cpu.isMemoryWriteBlocked()
			&& this.cpu.stalledMemoryWriteAddress() === address
			&& !this.ownsReadPort(address)
			&& !this.ownsWritePort(address)) {
			this.cpu.resumeMemoryWrite(address);
		}
	}

	private arbitrate(anchorCycle: number): void {
		if (this.restorePending || this.serviceActive || this.activeChannel !== DMA_CHANNEL_NONE) {
			return;
		}
		if (this.supervisorAdmissionQuiesceRequested) {
			this.notifySupervisorBoundary();
			return;
		}
		for (let offset = 0; offset < IO_DMA_CHANNEL_COUNT; offset += 1) {
			const channel = (this.nextChannel + offset) % IO_DMA_CHANNEL_COUNT;
			if (!this.busy(channel)) {
				continue;
			}
			if (this.registers.channels[channel]!.transferCountWord === 0) {
				this.finishChannel(channel);
				continue;
			}
			const words = this.availableWords(this.registers.channels[channel]);
			if (words !== 0) {
				this.admitBlock(channel, words, anchorCycle);
				this.nextChannel = (channel + 1) % IO_DMA_CHANNEL_COUNT;
				return;
			}
		}
		this.notifySupervisorBoundary();
	}

	private admitBlock(channel: number, blockWords: number, anchorCycle: number): void {
		const registers = this.registers.channels[channel]!;
		const route = registers.controlWord & DMA_CONTROL_ROUTE_MASK;
		const read = READ_ENDPOINTS[route], write = WRITE_ENDPOINTS[route];
		const readStep = read === DmaEndpoint.Memory ? IO_WORD_SIZE : 0;
		const writeStep = write === DmaEndpoint.Memory ? IO_WORD_SIZE : 0;
		const readAddress = readStep !== 0 ? registers.readAddressWord : ENDPOINT_ADDRESSES[read];
		const writeAddress = writeStep !== 0 ? registers.writeAddressWord : ENDPOINT_ADDRESSES[write];
		const blockCycles = this.regionSpanCycles(this.memory.mappedRegion(readAddress), blockWords)
			+ this.regionSpanCycles(this.memory.mappedRegion(writeAddress), blockWords);
		this.activeChannel = channel;
		this.scheduledBlockWords = blockWords;
		this.serviceDeadline = anchorCycle + blockCycles;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
		this.scheduler.requestYieldForEarlierDeadline(this.scheduler.currentNowCycles());
	}

	private regionSpanCycles(region: MemoryRegionKind, wordCount: number): number {
		switch (region) {
			case MemoryRegionKind.Ram:
				return wordCount * this.ramCyclesPerWord + this.ramBurstSetupCycles;
			case MemoryRegionKind.SystemRom:
				return wordCount * this.systemRomCyclesPerWord;
			case MemoryRegionKind.Cartridge:
				return wordCount * this.cartRomCyclesPerWord + this.cartRomBurstSetupCycles;
			case MemoryRegionKind.Io:
			case MemoryRegionKind.Other:
				return wordCount;
		}
	}

	private availableWords(registers: DmaChannelStates[number]): number {
		const control = registers.controlWord;
		const route = control & DMA_CONTROL_ROUTE_MASK;
		let read: DmaEndpoint = READ_ENDPOINTS[route];
		let write: DmaEndpoint = WRITE_ENDPOINTS[route];
		if (read === DmaEndpoint.Memory && registers.readAddressWord >= CART_MMIO_BASE && registers.readAddressWord < CART_MMIO_END) {
			read = ((control >>> DMA_CONTROL_READ_SLOT_SHIFT) & 1) !== 0 ? DmaEndpoint.Cartridge1Read : DmaEndpoint.Cartridge0Read;
		}
		if (write === DmaEndpoint.Memory && registers.writeAddressWord >= CART_MMIO_BASE && registers.writeAddressWord < CART_MMIO_END) {
			write = ((control >>> DMA_CONTROL_WRITE_SLOT_SHIFT) & 1) !== 0 ? DmaEndpoint.Cartridge1Write : DmaEndpoint.Cartridge0Write;
		}
		let words = Math.min(registers.transferCountWord, DMA_BURST_WORD_CAPACITY, this.endpointCapacity[read], this.endpointCapacity[write]);
		if (READ_ENDPOINTS[route] === DmaEndpoint.Memory) {
			words = this.memory.mappedRegionWordSpan(registers.readAddressWord, words, this.memory.mappedRegion(registers.readAddressWord));
		}
		if (WRITE_ENDPOINTS[route] === DmaEndpoint.Memory) {
			words = this.memory.mappedRegionWordSpan(registers.writeAddressWord, words, this.memory.mappedRegion(registers.writeAddressWord));
		}
		return words;
	}

	private busy(channel: number): boolean {
		return (this.registers.channels[channel]!.statusWord & DMA_STATUS_BUSY) !== 0;
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiesceRequested && this.supervisorQuiescent()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}
}
