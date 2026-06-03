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

	public read(addr: number): number {
		switch (addr) {
			case IO_APU_OUTPUT_QUEUED_FRAMES:
				return this.outputRing.queuedFrames();
			case IO_APU_OUTPUT_FREE_FRAMES:
				return this.outputRing.freeFrames();
			case IO_APU_OUTPUT_CAPACITY_FRAMES:
				return this.outputRing.capacityFrames();
			case IO_APU_CMD_QUEUED:
				return this.commandFifo.count;
			case IO_APU_CMD_FREE:
				return this.commandFifo.free;
			case IO_APU_CMD_CAPACITY:
				return this.commandFifo.capacity;
		}
		throw new Error('[APU] Queue-status register read was mapped to an unknown address.');
	}
}
