import { IO_APU_CMD } from '../../../spec/bmsx/io';
import type { Memory } from '../../memory/memory';
import type { DeviceScheduler } from '../../scheduler/device';
import type { DeviceStatusLatch } from '../device_status';
import { clearApuCommandLatch } from './command_latch';
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
		private readonly memory: Memory,
		private readonly commandFifo: ApuCommandFifo,
		private readonly fault: DeviceStatusLatch,
		private readonly serviceClock: ApuServiceClock,
		private readonly scheduler: DeviceScheduler,
	) {}

	public static onCommandWriteThunk(context: ApuCommandIngress): void {
		const nowCycles = context.scheduler.currentNowCycles();
		context.serviceClock.synchronize(nowCycles);
		const command = context.memory.readIoU32(IO_APU_CMD);
		switch (command) {
			case APU_CMD_PLAY:
			case APU_CMD_STOP_SLOT:
			case APU_CMD_SET_SLOT_GAIN:
				context.commandFifo.enqueue(command, context.memory);
				context.serviceClock.scheduleNext(nowCycles);
				clearApuCommandLatch(context.memory);
				return;
			case APU_CMD_NONE:
				context.serviceClock.scheduleNext(nowCycles);
				return;
			default:
				context.fault.raise(APU_FAULT_BAD_CMD, command);
				clearApuCommandLatch(context.memory);
				context.serviceClock.scheduleNext(nowCycles);
				return;
		}
	}
}
