import {
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
} from '../../../spec/audio/apu';
import type { ApuSlotBank } from './slot_bank';
import { IO_APU_SELECTED_SOURCE_ADDR } from '../../../spec/bmsx/io';
import type { Memory } from '../../memory/memory';
import type { DeviceStatusLatch } from '../device_status';

export class ApuSelectedSlotLatch {
	public constructor(
		private readonly memory: Memory,
		private readonly status: DeviceStatusLatch,
		private readonly slots: ApuSlotBank,
	) {}

	public refresh(slot: number): void {
		const active = (this.slots.activeMask & (1 << slot)) !== 0;
		this.memory.writeIoU32(IO_APU_SELECTED_SOURCE_ADDR, active ? this.slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX) : 0);
		this.status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
	}
}
