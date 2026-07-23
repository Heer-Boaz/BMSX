import {
	DMA_CONTROL_BLOCK_WORDS_MASK,
	DMA_CONTROL_BLOCK_WORDS_SHIFT,
	DMA_CONTROL_READ_INCREMENT,
	DMA_CONTROL_READ_REQUEST_MASK,
	DMA_CONTROL_READ_REQUEST_SHIFT,
	DMA_CONTROL_WRITE_INCREMENT,
	DMA_CONTROL_WRITE_REQUEST_MASK,
	DMA_CONTROL_WRITE_REQUEST_SHIFT,
	DMA_REQUEST_DISABLED,
	DMA_REQUEST_FORCE,
	DMA_REQUEST_CARTRIDGE_SLOT0_READ,
	DMA_REQUEST_CARTRIDGE_SLOT0_WRITE,
	DMA_REQUEST_CARTRIDGE_SLOT1_READ,
	DMA_REQUEST_CARTRIDGE_SLOT1_WRITE,
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	IO_DMA_CHANNEL_COUNT,
	IO_DMA_CONTROLS,
	IO_DMA_READ_ADDRS,
	IO_DMA_STATUSES,
	IO_DMA_TRANSFER_COUNTS,
	IO_DMA_TRIGGERS,
	IO_DMA_WRITE_ADDRS,
	IRQ_DMA0_DONE,
	IRQ_DMA1_DONE,
} from '../../bus/io';
import type { CPU, Value } from '../../cpu/cpu';
import { IO_WORD_SIZE } from '../../memory/map';
import {
	MAPPED_BUS_CARTRIDGE_SLOT1,
	MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE,
	MAPPED_BUS_DMA_BLOCK_END,
	MAPPED_BUS_MASTER_DMA,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import { Memory, MemoryRegionKind } from '../../memory/memory';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
import type { IrqController } from '../irq/controller';

const DMA_CHANNEL_NONE = IO_DMA_CHANNEL_COUNT;

export type DmaChannelState = {
	readAddressWord: number;
	writeAddressWord: number;
	transferCountWord: number;
	controlWord: number;
	statusWord: number;
};

export type DmaControllerState = {
	channels: [DmaChannelState, DmaChannelState];
	activeChannel: number;
	nextChannel: number;
	scheduledBlockWords: number;
	scheduledBlockCycles: number;
	scheduledReadAddressWord: number;
	scheduledWriteAddressWord: number;
	scheduledTransferCountWord: number;
	scheduledControlWord: number;
	supervisorQuiesceRequested: boolean;
	supervisorAdmissionQuiesceRequested: boolean;
	userChannels: [DmaChannelState, DmaChannelState];
	userNextChannel: number;
};

export class DmaController {
	private ramCyclesPerWord = 1;
	private ramBurstSetupCycles = 0;
	private systemRomCyclesPerWord = 1;
	private cartRomCyclesPerWord = 0;
	private cartRomBurstSetupCycles = 0;
	private activeChannel = DMA_CHANNEL_NONE;
	private nextChannel = 0;
	private scheduledBlockWords = 0;
	private scheduledReadAddressWord = 0;
	private scheduledWriteAddressWord = 0;
	private scheduledTransferCountWord = 0;
	private scheduledControlWord = 0;
	private serviceDeadline = 0;
	private requestLines = 0;
	private serviceActive = false;
	private restorePending = false;
	private supervisorQuiesceRequested = false;
	private supervisorAdmissionQuiesceRequested = false;
	private readonly userChannels: [DmaChannelState, DmaChannelState] = [
		{ readAddressWord: 0, writeAddressWord: 0, transferCountWord: 0, controlWord: 0, statusWord: 0 },
		{ readAddressWord: 0, writeAddressWord: 0, transferCountWord: 0, controlWord: 0, statusWord: 0 },
	];
	private userNextChannel = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			this.memory.mapIoWrite(IO_DMA_CONTROLS[channel]!, this, DmaController.controlWriteThunk);
			this.memory.mapIoWrite(IO_DMA_READ_ADDRS[channel]!, this, DmaController.addressWriteThunk);
			this.memory.mapIoWrite(IO_DMA_WRITE_ADDRS[channel]!, this, DmaController.addressWriteThunk);
			this.memory.mapIoWrite(IO_DMA_TRANSFER_COUNTS[channel]!, this, DmaController.transferCountWriteThunk);
			this.memory.mapIoWrite(IO_DMA_TRIGGERS[channel]!, this, DmaController.triggerWriteThunk);
			this.memory.mapIoWriteReady(IO_DMA_TRIGGERS[channel]!, DmaController.triggerWriteReadyThunk);
		}
	}

	private static triggerWriteReadyThunk(context: DmaController): boolean {
		return !context.supervisorQuiesceRequested;
	}

	private static controlWriteThunk(context: DmaController): void {
		context.arbitrate(context.scheduler.currentNowCycles());
	}

	private static addressWriteThunk(context: DmaController): void {
		if (!context.cpu.isMemoryWriteBlocked()) {
			return;
		}
		context.resumeCpuWriteIfPortReleased(context.cpu.stalledMemoryWriteAddress());
	}

	private static transferCountWriteThunk(context: DmaController): void {
		context.arbitrate(context.scheduler.currentNowCycles());
	}

	private static triggerWriteThunk(context: DmaController, address: number, value: Value): void {
		const channel = address === IO_DMA_TRIGGERS[1] ? 1 : 0;
		context.memory.writeIoValue(IO_DMA_TRIGGERS[channel]!, 0);
		if (((value as number) & DMA_TRIGGER_START) === 0 || context.busy(channel)) {
			return;
		}
		context.memory.writeIoValue(IO_DMA_STATUSES[channel]!, DMA_STATUS_BUSY);
		if (context.memory.readIoU32(IO_DMA_TRANSFER_COUNTS[channel]!) === 0) {
			context.finishChannel(channel);
		}
		context.arbitrate(context.scheduler.currentNowCycles());
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

	public setRequestLines(mask: number, asserted: number): void {
		const next = (this.requestLines & ~mask) | (asserted & mask);
		if (next === this.requestLines) {
			return;
		}
		this.requestLines = next;
		this.arbitrate(this.scheduler.currentNowCycles());
	}

	public ownsReadPort(address: number): boolean {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			if (this.busy(channel) && this.channelReadAddress(channel) === address) {
				return true;
			}
		}
		return false;
	}

	public ownsWritePort(address: number): boolean {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			if (this.busy(channel) && this.channelWriteAddress(channel) === address) {
				return true;
			}
		}
		return false;
	}

	public hasAdmittedWriteBlock(address: number): boolean {
		return this.activeChannel !== DMA_CHANNEL_NONE
			&& this.scheduledWriteAddressWord === address;
	}

	public reset(): void {
		this.clearLiveTransfer();
		this.requestLines = 0;
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
		this.clearUserContext();
	}

	public onService(_nowCycles: number): void {
		const channel = this.activeChannel;
		const blockWords = this.scheduledBlockWords;
		let readAddress = this.scheduledReadAddressWord;
		let writeAddress = this.scheduledWriteAddressWord;
		const releasedReadAddress = readAddress;
		const releasedWriteAddress = writeAddress;
		let transferCount = this.scheduledTransferCountWord;
		const control = this.scheduledControlWord;
		const readStep = (control & DMA_CONTROL_READ_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		const writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		const readRequest = (control & DMA_CONTROL_READ_REQUEST_MASK) >>> DMA_CONTROL_READ_REQUEST_SHIFT;
		const writeRequest = (control & DMA_CONTROL_WRITE_REQUEST_MASK) >>> DMA_CONTROL_WRITE_REQUEST_SHIFT;
		const readBusSignals = MAPPED_BUS_MASTER_DMA | this.cartridgeSlotSignals(readRequest);
		const writeBusSignals = MAPPED_BUS_MASTER_DMA | this.cartridgeSlotSignals(writeRequest);
		const blockDeadline = this.serviceDeadline;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.serviceActive = true;
		for (let slot = 0; slot < blockWords; slot += 1) {
			const blockEnd = slot + 1 === blockWords ? MAPPED_BUS_DMA_BLOCK_END : 0;
			const word = this.memory.readMappedDmaU32LE(readAddress, readBusSignals | blockEnd);
			this.memory.writeMappedDmaU32LE(writeAddress, word, writeBusSignals | blockEnd);
			readAddress = (readAddress + readStep) >>> 0;
			writeAddress = (writeAddress + writeStep) >>> 0;
			transferCount = (transferCount - 1) >>> 0;
		}
		this.memory.writeIoValue(IO_DMA_READ_ADDRS[channel]!, readAddress);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDRS[channel]!, writeAddress);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNTS[channel]!, transferCount);
		this.serviceActive = false;
		this.clearAdmittedBlock();
		this.resumeCpuWriteIfPortReleased(releasedReadAddress);
		if (releasedWriteAddress !== releasedReadAddress) {
			this.resumeCpuWriteIfPortReleased(releasedWriteAddress);
		}
		if (transferCount === 0) {
			this.finishChannel(channel);
		}
		this.arbitrate(blockDeadline);
	}

	public captureState(): DmaControllerState {
		return {
			channels: [this.captureChannel(0), this.captureChannel(1)],
			activeChannel: this.activeChannel,
			nextChannel: this.nextChannel,
			scheduledBlockWords: this.scheduledBlockWords,
			scheduledBlockCycles: this.scheduledBlockWords === 0
				? 0
				: this.serviceDeadline - this.scheduler.currentNowCycles(),
			scheduledReadAddressWord: this.scheduledReadAddressWord,
			scheduledWriteAddressWord: this.scheduledWriteAddressWord,
			scheduledTransferCountWord: this.scheduledTransferCountWord,
			scheduledControlWord: this.scheduledControlWord,
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			supervisorAdmissionQuiesceRequested: this.supervisorAdmissionQuiesceRequested,
			userChannels: [
				{ ...this.userChannels[0] },
				{ ...this.userChannels[1] },
			],
			userNextChannel: this.userNextChannel,
		};
	}

	public restoreState(state: DmaControllerState, nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.restoreChannel(0, state.channels[0]);
		this.restoreChannel(1, state.channels[1]);
		this.activeChannel = state.activeChannel;
		this.nextChannel = state.nextChannel;
		this.scheduledBlockWords = state.scheduledBlockWords;
		this.scheduledReadAddressWord = state.scheduledReadAddressWord >>> 0;
		this.scheduledWriteAddressWord = state.scheduledWriteAddressWord >>> 0;
		this.scheduledTransferCountWord = state.scheduledTransferCountWord >>> 0;
		this.scheduledControlWord = state.scheduledControlWord >>> 0;
		this.serviceDeadline = nowCycles + state.scheduledBlockCycles;
		this.serviceActive = false;
		this.restorePending = true;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.supervisorAdmissionQuiesceRequested = state.supervisorAdmissionQuiesceRequested;
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			const source = state.userChannels[channel]!;
			const target = this.userChannels[channel]!;
			target.readAddressWord = source.readAddressWord >>> 0;
			target.writeAddressWord = source.writeAddressWord >>> 0;
			target.transferCountWord = source.transferCountWord >>> 0;
			target.controlWord = source.controlWord >>> 0;
			target.statusWord = source.statusWord >>> 0;
		}
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
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			const userChannel = this.userChannels[channel]!;
			userChannel.readAddressWord = this.memory.readIoU32(IO_DMA_READ_ADDRS[channel]!);
			userChannel.writeAddressWord = this.memory.readIoU32(IO_DMA_WRITE_ADDRS[channel]!);
			userChannel.transferCountWord = this.memory.readIoU32(IO_DMA_TRANSFER_COUNTS[channel]!);
			userChannel.controlWord = this.memory.readIoU32(IO_DMA_CONTROLS[channel]!);
			userChannel.statusWord = this.memory.readIoU32(IO_DMA_STATUSES[channel]!);
		}
		this.userNextChannel = this.nextChannel;
		this.clearLiveTransfer();
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
	}

	public enterSupervisorFaultContext(): void {
		this.clearLiveTransfer();
		this.clearUserContext();
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
	}

	public leaveSupervisorContext(): void {
		this.clearLiveTransfer();
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			this.restoreChannel(channel, this.userChannels[channel]!);
		}
		this.nextChannel = this.userNextChannel;
		this.supervisorQuiesceRequested = false;
		this.supervisorAdmissionQuiesceRequested = false;
		this.clearUserContext();
		this.arbitrate(this.scheduler.currentNowCycles());
	}

	private captureChannel(channel: number): DmaChannelState {
		return {
			readAddressWord: this.memory.readIoU32(IO_DMA_READ_ADDRS[channel]!),
			writeAddressWord: this.memory.readIoU32(IO_DMA_WRITE_ADDRS[channel]!),
			transferCountWord: this.memory.readIoU32(IO_DMA_TRANSFER_COUNTS[channel]!),
			controlWord: this.memory.readIoU32(IO_DMA_CONTROLS[channel]!),
			statusWord: this.memory.readIoU32(IO_DMA_STATUSES[channel]!),
		};
	}

	private restoreChannel(channel: number, state: DmaChannelState): void {
		this.memory.writeIoValue(IO_DMA_READ_ADDRS[channel]!, state.readAddressWord);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDRS[channel]!, state.writeAddressWord);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNTS[channel]!, state.transferCountWord);
		this.memory.writeIoValue(IO_DMA_CONTROLS[channel]!, state.controlWord);
		this.memory.writeIoValue(IO_DMA_STATUSES[channel]!, state.statusWord);
		this.memory.writeIoValue(IO_DMA_TRIGGERS[channel]!, 0);
	}

	private clearLiveTransfer(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.clearAdmittedBlock();
		this.nextChannel = 0;
		this.serviceActive = false;
		this.restorePending = false;
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			this.memory.writeIoValue(IO_DMA_READ_ADDRS[channel]!, 0);
			this.memory.writeIoValue(IO_DMA_WRITE_ADDRS[channel]!, 0);
			this.memory.writeIoValue(IO_DMA_TRANSFER_COUNTS[channel]!, 0);
			this.memory.writeIoValue(IO_DMA_CONTROLS[channel]!, 0);
			this.memory.writeIoValue(IO_DMA_STATUSES[channel]!, 0);
			this.memory.writeIoValue(IO_DMA_TRIGGERS[channel]!, 0);
		}
	}

	private clearUserContext(): void {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			const userChannel = this.userChannels[channel]!;
			userChannel.readAddressWord = 0;
			userChannel.writeAddressWord = 0;
			userChannel.transferCountWord = 0;
			userChannel.controlWord = 0;
			userChannel.statusWord = 0;
		}
		this.userNextChannel = 0;
	}

	private clearAdmittedBlock(): void {
		this.activeChannel = DMA_CHANNEL_NONE;
		this.scheduledBlockWords = 0;
		this.scheduledReadAddressWord = 0;
		this.scheduledWriteAddressWord = 0;
		this.scheduledTransferCountWord = 0;
		this.scheduledControlWord = 0;
		this.serviceDeadline = 0;
	}

	private finishChannel(channel: number): void {
		const readAddress = this.channelReadAddress(channel);
		const writeAddress = this.channelWriteAddress(channel);
		this.memory.writeIoValue(IO_DMA_STATUSES[channel]!, DMA_STATUS_DONE);
		this.irq.raise(channel === 0 ? IRQ_DMA0_DONE : IRQ_DMA1_DONE);
		this.resumeCpuWriteIfPortReleased(readAddress);
		if (writeAddress !== readAddress) {
			this.resumeCpuWriteIfPortReleased(writeAddress);
		}
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
			if (this.memory.readIoU32(IO_DMA_TRANSFER_COUNTS[channel]!) === 0) {
				this.finishChannel(channel);
				continue;
			}
			if (this.requestAsserted(channel)) {
				this.admitBlock(channel, anchorCycle);
				this.nextChannel = (channel + 1) % IO_DMA_CHANNEL_COUNT;
				return;
			}
		}
		this.notifySupervisorBoundary();
	}

	private admitBlock(channel: number, anchorCycle: number): void {
		const remaining = this.memory.readIoU32(IO_DMA_TRANSFER_COUNTS[channel]!);
		const control = this.memory.readIoU32(IO_DMA_CONTROLS[channel]!);
		const programmedBlockWords = ((control & DMA_CONTROL_BLOCK_WORDS_MASK) >>> DMA_CONTROL_BLOCK_WORDS_SHIFT) + 1;
		const blockWords = remaining < programmedBlockWords ? remaining : programmedBlockWords;
		const readStep = (control & DMA_CONTROL_READ_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		const writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		let readAddress = this.memory.readIoU32(IO_DMA_READ_ADDRS[channel]!);
		let writeAddress = this.memory.readIoU32(IO_DMA_WRITE_ADDRS[channel]!);
		const scheduledReadAddress = readAddress;
		const scheduledWriteAddress = writeAddress;
		let readRegion = this.memory.mappedRegion(readAddress);
		let writeRegion = this.memory.mappedRegion(writeAddress);
		let readRegionWords = readStep === 0
			? blockWords
			: this.memory.mappedRegionWordSpan(readAddress, blockWords, readRegion);
		let writeRegionWords = writeStep === 0
			? blockWords
			: this.memory.mappedRegionWordSpan(writeAddress, blockWords, writeRegion);
		let readRegionStart = true;
		let writeRegionStart = true;
		let wordsRemaining = blockWords;
		let blockCycles = 0;
		while (wordsRemaining !== 0) {
			const spanWords = readRegionWords < writeRegionWords ? readRegionWords : writeRegionWords;
			const readCycles = this.regionSpanCycles(readRegion, spanWords, readRegionStart);
			const writeCycles = this.regionSpanCycles(writeRegion, spanWords, writeRegionStart);
			blockCycles += readRegion === writeRegion
				&& (readRegion === MemoryRegionKind.Ram || readRegion === MemoryRegionKind.Cartridge)
				? readCycles + writeCycles
				: readCycles > writeCycles ? readCycles : writeCycles;
			wordsRemaining -= spanWords;
			readRegionWords -= spanWords;
			writeRegionWords -= spanWords;
			readRegionStart = false;
			writeRegionStart = false;
			readAddress = (readAddress + spanWords * readStep) >>> 0;
			writeAddress = (writeAddress + spanWords * writeStep) >>> 0;
			if (wordsRemaining !== 0 && readRegionWords === 0) {
				readRegion = this.memory.mappedRegion(readAddress);
				readRegionWords = this.memory.mappedRegionWordSpan(readAddress, wordsRemaining, readRegion);
				readRegionStart = true;
			}
			if (wordsRemaining !== 0 && writeRegionWords === 0) {
				writeRegion = this.memory.mappedRegion(writeAddress);
				writeRegionWords = this.memory.mappedRegionWordSpan(writeAddress, wordsRemaining, writeRegion);
				writeRegionStart = true;
			}
		}
		if (blockCycles === 0) {
			blockCycles = 1;
		}
		this.activeChannel = channel;
		this.scheduledBlockWords = blockWords;
		this.scheduledReadAddressWord = scheduledReadAddress;
		this.scheduledWriteAddressWord = scheduledWriteAddress;
		this.scheduledTransferCountWord = remaining;
		this.scheduledControlWord = control;
		this.serviceDeadline = anchorCycle + blockCycles;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
	}

	private regionSpanCycles(region: MemoryRegionKind, wordCount: number, regionStart: boolean): number {
		switch (region) {
			case MemoryRegionKind.Ram:
				return wordCount * this.ramCyclesPerWord + (regionStart ? this.ramBurstSetupCycles : 0);
			case MemoryRegionKind.SystemRom:
				return wordCount * this.systemRomCyclesPerWord;
			case MemoryRegionKind.Cartridge:
				return wordCount * this.cartRomCyclesPerWord + (regionStart ? this.cartRomBurstSetupCycles : 0);
			case MemoryRegionKind.Io:
			case MemoryRegionKind.Other:
				return 0;
		}
	}

	private requestAsserted(channel: number): boolean {
		const control = this.memory.readIoU32(IO_DMA_CONTROLS[channel]!);
		const readRequest = (control & DMA_CONTROL_READ_REQUEST_MASK) >>> DMA_CONTROL_READ_REQUEST_SHIFT;
		const writeRequest = (control & DMA_CONTROL_WRITE_REQUEST_MASK) >>> DMA_CONTROL_WRITE_REQUEST_SHIFT;
		return this.requestLineAsserted(readRequest) && this.requestLineAsserted(writeRequest);
	}

	private requestLineAsserted(request: number): boolean {
		if (request === DMA_REQUEST_FORCE) {
			return true;
		}
		if (request === DMA_REQUEST_DISABLED) {
			return false;
		}
		return (this.requestLines & (1 << request)) !== 0;
	}

	private cartridgeSlotSignals(request: number): MappedBusSignals {
		switch (request) {
			case DMA_REQUEST_CARTRIDGE_SLOT0_READ:
			case DMA_REQUEST_CARTRIDGE_SLOT0_WRITE:
				return MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE;
			case DMA_REQUEST_CARTRIDGE_SLOT1_READ:
			case DMA_REQUEST_CARTRIDGE_SLOT1_WRITE:
				return MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE | MAPPED_BUS_CARTRIDGE_SLOT1;
			default:
				return 0;
		}
	}

	private busy(channel: number): boolean {
		return (this.memory.readIoU32(IO_DMA_STATUSES[channel]!) & DMA_STATUS_BUSY) !== 0;
	}

	private channelReadAddress(channel: number): number {
		return channel === this.activeChannel
			? this.scheduledReadAddressWord
			: this.memory.readIoU32(IO_DMA_READ_ADDRS[channel]!);
	}

	private channelWriteAddress(channel: number): number {
		return channel === this.activeChannel
			? this.scheduledWriteAddressWord
			: this.memory.readIoU32(IO_DMA_WRITE_ADDRS[channel]!);
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiesceRequested && this.supervisorQuiescent()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}
}
