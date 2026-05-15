import {
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_COUNT,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
} from './contracts';
import type { ApuSlotBank } from './slot_bank';
import { IO_APU_SELECTED_SOURCE_ADDR, IO_APU_SLOT } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import type { DeviceStatusLatch } from '../device_status';

export class ApuSelectedSlotLatch {
	public constructor(
		private readonly memory: Memory,
		private readonly status: DeviceStatusLatch,
		private readonly slots: ApuSlotBank,
	) {}

	public reset(): void {
		this.memory.writeValue(IO_APU_SELECTED_SOURCE_ADDR, 0);
		this.status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, false);
	}

	public refresh(): void {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		const active = slot < APU_SLOT_COUNT && (this.slots.activeMask & (1 << slot)) !== 0;
		this.memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, active ? this.slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX) : 0);
		this.status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
	}
}
