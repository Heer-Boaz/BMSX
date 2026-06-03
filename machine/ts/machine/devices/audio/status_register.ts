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

	public read(): number {
		const busy = this.slots.activeMask !== 0 || !this.commandFifo.empty;
		const commandFifoEmpty = this.commandFifo.empty;
		const commandFifoFull = this.commandFifo.full;
		const queuedFrames = this.outputRing.queuedFrames();
		const outputEmpty = queuedFrames === 0;
		const outputFull = queuedFrames >= this.outputRing.capacityFrames();
		return (this.fault.status
			| (busy ? APU_STATUS_BUSY : 0)
			| (commandFifoEmpty ? APU_STATUS_CMD_FIFO_EMPTY : 0)
			| (commandFifoFull ? APU_STATUS_CMD_FIFO_FULL : 0)
			| (outputEmpty ? APU_STATUS_OUTPUT_EMPTY : 0)
			| (outputFull ? APU_STATUS_OUTPUT_FULL : 0)) >>> 0;
	}
}
