import {
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_INDEX_MASK,
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

	public static refreshThunk(context: ApuSelectedSlotLatch): void {
		const slot = context.memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
		const active = (context.slots.activeMask & (1 << slot)) !== 0;
		context.memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, active ? context.slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX) : 0);
		context.status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
	}
}
