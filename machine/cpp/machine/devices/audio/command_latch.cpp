#include "machine/devices/audio/command_latch.h"

#include "machine/bus/io.h"
#include "machine/devices/audio/contracts.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {

void resetApuCommandLatch(Memory& memory) {
	memory.writeValue(IO_APU_SOURCE_ADDR, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_BYTES, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_CHANNELS, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, valueNumber(0.0));
	memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, valueNumber(0.0));
	memory.writeValue(IO_APU_SLOT, valueNumber(0.0));
	memory.writeValue(IO_APU_RATE_STEP_Q16, valueNumber(static_cast<double>(APU_RATE_STEP_Q16_ONE)));
	memory.writeValue(IO_APU_GAIN_Q12, valueNumber(static_cast<double>(APU_GAIN_Q12_ONE)));
	memory.writeValue(IO_APU_START_SAMPLE, valueNumber(0.0));
	memory.writeValue(IO_APU_FILTER_KIND, valueNumber(static_cast<double>(APU_FILTER_NONE)));
	memory.writeValue(IO_APU_FILTER_FREQ_HZ, valueNumber(0.0));
	memory.writeValue(IO_APU_FILTER_Q_MILLI, valueNumber(1000.0));
	memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, valueNumber(0.0));
	memory.writeValue(IO_APU_FADE_SAMPLES, valueNumber(0.0));
	memory.writeValue(IO_APU_GENERATOR_KIND, valueNumber(static_cast<double>(APU_GENERATOR_NONE)));
	memory.writeValue(IO_APU_GENERATOR_DUTY_Q12, valueNumber(static_cast<double>(APU_GAIN_Q12_ONE / 2u)));
}

} // namespace

void clearApuCommandLatch(Memory& memory) {
	resetApuCommandLatch(memory);
	memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
}

} // namespace bmsx
