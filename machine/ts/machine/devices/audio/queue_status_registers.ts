import {
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
} from '../../../spec/bmsx/io';
import type { ApuCommandFifo } from './command_fifo';

export class ApuQueueStatusRegisters {
	public constructor(private readonly commandFifo: ApuCommandFifo) {}

	public static readThunk(context: ApuQueueStatusRegisters, addr: number): number {
		switch (addr) {
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
