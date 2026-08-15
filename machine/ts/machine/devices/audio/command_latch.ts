import {
	APU_CMD_NONE,
	APU_FILTER_COEFFICIENT_ONE,
	APU_GAIN_Q12_ONE,
	APU_GENERATOR_NONE,
	APU_PARAMETER_FILTER_B0_B1_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_GENERATOR_KIND_INDEX,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_SLOT_INDEX,
	APU_RATE_STEP_Q16_ONE,
	APU_SLOT_INDEX_MASK,
} from '../../../spec/audio/apu';
import {
	IO_APU_CMD,
	IO_APU_PARAMETER_REGISTER_ADDRS,
	IO_APU_SOURCE_ADDR,
	IO_ARG_STRIDE,
} from '../../../spec/bmsx/io';
import type { Memory } from '../../memory/memory';
import type { ApuSelectedSlotLatch } from './selected_slot_latch';

export class ApuCommandLatch {
	public readonly registerWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);

	public constructor(
		private readonly memory: Memory,
		private readonly selectedSlotLatch: ApuSelectedSlotLatch,
	) {
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			memory.mapIoWrite(
				IO_APU_PARAMETER_REGISTER_ADDRS[index]!,
				this,
				ApuCommandLatch.parameterWriteThunk,
			);
		}
	}

	private static parameterWriteThunk(context: ApuCommandLatch, address: number, value: number): void {
		const index = (address - IO_APU_SOURCE_ADDR) / IO_ARG_STRIDE;
		context.registerWords[index] = value;
		if (index === APU_PARAMETER_SLOT_INDEX) {
			context.selectedSlotLatch.refresh(value & APU_SLOT_INDEX_MASK);
		}
	}

	public clear(): void {
		this.registerWords.fill(0);
		this.registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX] = APU_RATE_STEP_Q16_ONE;
		this.registerWords[APU_PARAMETER_GAIN_Q12_INDEX] = APU_GAIN_Q12_ONE;
		this.registerWords[APU_PARAMETER_FILTER_B0_B1_INDEX] = APU_FILTER_COEFFICIENT_ONE;
		this.registerWords[APU_PARAMETER_GENERATOR_KIND_INDEX] = APU_GENERATOR_NONE;
		this.registerWords[APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX] = APU_GAIN_Q12_ONE >>> 1;
		this.mirrorRegisters();
	}

	public restore(registerWords: ArrayLike<number>): void {
		this.registerWords.set(registerWords);
		this.mirrorRegisters();
	}

	private mirrorRegisters(): void {
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.memory.writeIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!, this.registerWords[index]!);
		}
		this.memory.writeIoU32(IO_APU_CMD, APU_CMD_NONE);
		this.selectedSlotLatch.refresh(this.registerWords[APU_PARAMETER_SLOT_INDEX]! & APU_SLOT_INDEX_MASK);
	}
}
