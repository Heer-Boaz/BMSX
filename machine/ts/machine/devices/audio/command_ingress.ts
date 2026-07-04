import { IO_APU_CMD } from '../../bus/io';
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
} from './contracts';
import type { ApuServiceClock } from './service_clock';

export class ApuCommandIngress {
	public constructor(
		private readonly memory: Memory,
		private readonly commandFifo: ApuCommandFifo,
		private readonly fault: DeviceStatusLatch,
		private readonly serviceClock: ApuServiceClock,
		private readonly scheduler: DeviceScheduler,
	) {}

	public onCommandWrite(): void {
		const command = this.memory.readIoU32(IO_APU_CMD);
		switch (command) {
			case APU_CMD_PLAY:
			case APU_CMD_STOP_SLOT:
			case APU_CMD_SET_SLOT_GAIN:
				this.commandFifo.enqueue(command, this.memory);
				this.serviceClock.scheduleNext(this.scheduler.currentNowCycles());
				clearApuCommandLatch(this.memory);
				return;
			case APU_CMD_NONE:
				return;
			default:
				this.fault.raise(APU_FAULT_BAD_CMD, command);
				clearApuCommandLatch(this.memory);
				return;
		}
	}

}
