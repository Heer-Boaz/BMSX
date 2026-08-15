import type { DeviceScheduler } from '../../scheduler/device';
import type { DeviceStatusLatch } from '../device_status';
import type { ApuCommandLatch } from './command_latch';
import type { ApuCommandFifo } from './command_fifo';
import {
	APU_CMD_NONE,
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_FAULT_BAD_CMD,
} from '../../../spec/audio/apu';
import type { ApuServiceClock } from './service_clock';

export class ApuCommandIngress {
	public constructor(
		private readonly commandLatch: ApuCommandLatch,
		private readonly commandFifo: ApuCommandFifo,
		private readonly fault: DeviceStatusLatch,
		private readonly serviceClock: ApuServiceClock,
		private readonly scheduler: DeviceScheduler,
	) {}

	public static onCommandWriteThunk(context: ApuCommandIngress, _address: number, command: number): void {
		const nowCycles = context.scheduler.currentNowCycles();
		context.serviceClock.synchronize(nowCycles);
		switch (command) {
			case APU_CMD_PLAY:
			case APU_CMD_STOP_SLOT:
			case APU_CMD_SET_SLOT_GAIN:
				context.commandFifo.enqueue(command, context.commandLatch.registerWords);
				context.serviceClock.scheduleNext(nowCycles);
				context.commandLatch.clear();
				return;
			case APU_CMD_NONE:
				context.serviceClock.scheduleNext(nowCycles);
				return;
			default:
				context.fault.raise(APU_FAULT_BAD_CMD, command);
				context.commandLatch.clear();
				context.serviceClock.scheduleNext(nowCycles);
				return;
		}
	}
}
