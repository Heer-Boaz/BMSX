import {
	APU_CMD_NONE,
	APU_FILTER_NONE,
	APU_GAIN_Q12_ONE,
	APU_GENERATOR_NONE,
	APU_RATE_STEP_Q16_ONE,
} from './contracts';
import {
	IO_APU_CMD,
	IO_APU_FADE_SAMPLES,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_GENERATOR_DUTY_Q12,
	IO_APU_GENERATOR_KIND,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SLOT,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_LOOP_START_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_APU_START_SAMPLE,
} from '../../bus/io';
import type { Memory } from '../../memory/memory';

function resetApuCommandLatch(memory: Memory): void {
	memory.writeValue(IO_APU_SOURCE_ADDR, 0);
	memory.writeValue(IO_APU_SOURCE_BYTES, 0);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, 0);
	memory.writeValue(IO_APU_SOURCE_CHANNELS, 0);
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 0);
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 0);
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 0);
	memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
	memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 0);
	memory.writeValue(IO_APU_SLOT, 0);
	memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeValue(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
	memory.writeValue(IO_APU_START_SAMPLE, 0);
	memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_NONE);
	memory.writeValue(IO_APU_FILTER_FREQ_HZ, 0);
	memory.writeValue(IO_APU_FILTER_Q_MILLI, 1000);
	memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 0);
	memory.writeValue(IO_APU_FADE_SAMPLES, 0);
	memory.writeValue(IO_APU_GENERATOR_KIND, APU_GENERATOR_NONE);
	memory.writeValue(IO_APU_GENERATOR_DUTY_Q12, APU_GAIN_Q12_ONE >>> 1);
}

export function clearApuCommandLatch(memory: Memory): void {
	resetApuCommandLatch(memory);
	memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
}
