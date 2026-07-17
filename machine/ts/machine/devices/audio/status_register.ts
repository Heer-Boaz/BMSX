import {
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
} from './contracts';
import type { DeviceScheduler } from '../../scheduler/device';
import type { ApuCommandFifo } from './command_fifo';
import type { ApuServiceClock } from './service_clock';
import type { ApuSlotBank } from './slot_bank';
import type { DeviceStatusLatch } from '../device_status';

export class ApuStatusRegister {
	public constructor(
		private readonly fault: DeviceStatusLatch,
		private readonly slots: ApuSlotBank,
		private readonly commandFifo: ApuCommandFifo,
		private readonly serviceClock: ApuServiceClock,
		private readonly scheduler: DeviceScheduler,
	) {}

	public static readThunk(context: ApuStatusRegister): number {
		const nowCycles = context.scheduler.currentNowCycles();
		context.serviceClock.synchronize(nowCycles);
		const busy = context.slots.activeMask !== 0 || !context.commandFifo.empty;
		return (context.fault.status
			| (busy ? APU_STATUS_BUSY : 0)
			| (context.commandFifo.empty ? APU_STATUS_CMD_FIFO_EMPTY : 0)
			| (context.commandFifo.full ? APU_STATUS_CMD_FIFO_FULL : 0)
			| context.serviceClock.sampleTransferStatusBits()) >>> 0;
	}
}
