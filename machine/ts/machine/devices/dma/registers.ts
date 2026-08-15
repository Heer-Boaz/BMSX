import {
	IO_DMA_CHANNEL_COUNT,
	IO_DMA_CONTROLS,
	IO_DMA_READ_ADDRS,
	IO_DMA_STATUSES,
	IO_DMA_TRANSFER_COUNTS,
	IO_DMA_TRIGGERS,
	IO_DMA_WRITE_ADDRS,
} from '../../../spec/bmsx/io';
import type { Memory } from '../../memory/memory';

export type DmaChannelState = {
	readAddressWord: number;
	writeAddressWord: number;
	transferCountWord: number;
	controlWord: number;
	statusWord: number;
};

export type DmaChannelStates = [DmaChannelState, DmaChannelState];

export class DmaRegisterFile {
	public readonly channels: DmaChannelStates = [
		{ readAddressWord: 0, writeAddressWord: 0, transferCountWord: 0, controlWord: 0, statusWord: 0 },
		{ readAddressWord: 0, writeAddressWord: 0, transferCountWord: 0, controlWord: 0, statusWord: 0 },
	];

	public clear(): void {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			const state = this.channels[channel]!;
			state.readAddressWord = 0;
			state.writeAddressWord = 0;
			state.transferCountWord = 0;
			state.controlWord = 0;
			state.statusWord = 0;
		}
	}

	public copyChannels(source: DmaChannelStates): void {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			const sourceChannel = source[channel]!;
			const targetChannel = this.channels[channel]!;
			targetChannel.readAddressWord = sourceChannel.readAddressWord;
			targetChannel.writeAddressWord = sourceChannel.writeAddressWord;
			targetChannel.transferCountWord = sourceChannel.transferCountWord;
			targetChannel.controlWord = sourceChannel.controlWord;
			targetChannel.statusWord = sourceChannel.statusWord;
		}
	}

	public captureChannels(): DmaChannelStates {
		return [
			{ ...this.channels[0] },
			{ ...this.channels[1] },
		];
	}

	public mirror(memory: Memory): void {
		for (let channel = 0; channel < IO_DMA_CHANNEL_COUNT; channel += 1) {
			const state = this.channels[channel]!;
			memory.writeIoU32(IO_DMA_READ_ADDRS[channel]!, state.readAddressWord);
			memory.writeIoU32(IO_DMA_WRITE_ADDRS[channel]!, state.writeAddressWord);
			memory.writeIoU32(IO_DMA_TRANSFER_COUNTS[channel]!, state.transferCountWord);
			memory.writeIoU32(IO_DMA_CONTROLS[channel]!, state.controlWord);
			memory.writeIoU32(IO_DMA_STATUSES[channel]!, state.statusWord);
			memory.writeIoU32(IO_DMA_TRIGGERS[channel]!, 0);
		}
	}
}
