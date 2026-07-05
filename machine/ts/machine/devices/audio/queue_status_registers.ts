import {
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
	IO_APU_OUTPUT_CAPACITY_FRAMES,
	IO_APU_OUTPUT_FREE_FRAMES,
	IO_APU_OUTPUT_QUEUED_FRAMES,
} from '../../bus/io';
import type { ApuCommandFifo } from './command_fifo';
import type { ApuOutputRing } from './output_ring';

export class ApuQueueStatusRegisters {
	public constructor(
		private readonly commandFifo: ApuCommandFifo,
		private readonly outputRing: ApuOutputRing,
	) {}

	public static readThunk(context: ApuQueueStatusRegisters, addr: number): number {
		switch (addr) {
			case IO_APU_OUTPUT_QUEUED_FRAMES:
				return context.outputRing.queuedFrames();
			case IO_APU_OUTPUT_FREE_FRAMES:
				return context.outputRing.freeFrames();
			case IO_APU_OUTPUT_CAPACITY_FRAMES:
				return context.outputRing.capacityFrames();
			case IO_APU_CMD_QUEUED:
				return context.commandFifo.count;
			case IO_APU_CMD_FREE:
				return context.commandFifo.free;
			case IO_APU_CMD_CAPACITY:
				return context.commandFifo.capacity;
		}
		throw new Error('[APU] Queue-status register read was mapped to an unknown address.');
	}
}
