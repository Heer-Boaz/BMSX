#include "machine/devices/audio/command_latch.h"

#include "spec/bmsx/io.h"
#include "spec/audio/apu.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {

void resetApuCommandLatch(Memory& memory) {
	memory.writeIoU32(IO_APU_SOURCE_ADDR, 0u);
	memory.writeIoU32(IO_APU_SOURCE_BYTES, 0u);
	memory.writeIoU32(IO_APU_SOURCE_SAMPLE_RATE_HZ, 0u);
	memory.writeIoU32(IO_APU_SOURCE_CHANNELS, 0u);
	memory.writeIoU32(IO_APU_SOURCE_BITS_PER_SAMPLE, 0u);
	memory.writeIoU32(IO_APU_SOURCE_FRAME_COUNT, 0u);
	memory.writeIoU32(IO_APU_SOURCE_DATA_OFFSET, 0u);
	memory.writeIoU32(IO_APU_SOURCE_DATA_BYTES, 0u);
	memory.writeIoU32(IO_APU_SOURCE_LOOP_START_SAMPLE, 0u);
	memory.writeIoU32(IO_APU_SOURCE_LOOP_END_SAMPLE, 0u);
	memory.writeIoU32(IO_APU_SLOT, 0u);
	memory.writeIoU32(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeIoU32(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
	memory.writeIoU32(IO_APU_START_SAMPLE, 0u);
	memory.writeIoU32(IO_APU_FILTER_CONTROL, 0u);
	memory.writeIoU32(IO_APU_FILTER_B0_B1, APU_FILTER_COEFFICIENT_ONE);
	memory.writeIoU32(IO_APU_FILTER_B2_A1, 0u);
	memory.writeIoU32(IO_APU_FILTER_A2, 0u);
	memory.writeIoU32(IO_APU_FADE_SAMPLES, 0u);
	memory.writeIoU32(IO_APU_GENERATOR_KIND, APU_GENERATOR_NONE);
	memory.writeIoU32(IO_APU_GENERATOR_DUTY_Q12, APU_GAIN_Q12_ONE / 2u);
}

} // namespace

void clearApuCommandLatch(Memory& memory) {
	resetApuCommandLatch(memory);
	memory.writeIoU32(IO_APU_CMD, APU_CMD_NONE);
}

} // namespace bmsx
