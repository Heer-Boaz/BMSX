import {
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_OUTPUT_EMPTY,
	APU_STATUS_OUTPUT_FULL,
} from './contracts';
import type { ApuCommandFifo } from './command_fifo';
import type { ApuOutputRing } from './output_ring';
import type { ApuSlotBank } from './slot_bank';
import type { DeviceStatusLatch } from '../device_status';

export class ApuStatusRegister {
	public constructor(
		private readonly fault: DeviceStatusLatch,
		private readonly slots: ApuSlotBank,
		private readonly commandFifo: ApuCommandFifo,
		private readonly outputRing: ApuOutputRing,
	) {}

	public static readThunk(context: ApuStatusRegister): number {
		const busy = context.slots.activeMask !== 0 || !context.commandFifo.empty;
		const commandFifoEmpty = context.commandFifo.empty;
		const commandFifoFull = context.commandFifo.full;
		const queuedFrames = context.outputRing.queuedFrames();
		const outputEmpty = queuedFrames === 0;
		const outputFull = queuedFrames >= context.outputRing.capacityFrames();
		return (context.fault.status
			| (busy ? APU_STATUS_BUSY : 0)
			| (commandFifoEmpty ? APU_STATUS_CMD_FIFO_EMPTY : 0)
			| (commandFifoFull ? APU_STATUS_CMD_FIFO_FULL : 0)
			| (outputEmpty ? APU_STATUS_OUTPUT_EMPTY : 0)
			| (outputFull ? APU_STATUS_OUTPUT_FULL : 0)) >>> 0;
	}
}
