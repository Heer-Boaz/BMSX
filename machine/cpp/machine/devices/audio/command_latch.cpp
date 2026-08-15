#include "machine/devices/audio/command_latch.h"

#include "machine/devices/audio/selected_slot_latch.h"
#include "machine/memory/memory.h"
#include "spec/audio/apu.h"
#include "spec/bmsx/io.h"

namespace bmsx {

ApuCommandLatch::ApuCommandLatch(Memory& memory, ApuSelectedSlotLatch& selectedSlotLatch)
	: m_memory(memory)
	, m_selectedSlotLatch(selectedSlotLatch) {
	for (u32 index = 0u; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.mapIoWrite(IO_APU_PARAMETER_REGISTER_ADDRS[index], this, &ApuCommandLatch::parameterWriteThunk);
	}
}

void ApuCommandLatch::parameterWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals) {
	auto& latch = *static_cast<ApuCommandLatch*>(context);
	const u32 index = (addr - IO_APU_SOURCE_ADDR) / IO_WORD_SIZE;
	latch.m_registerWords[index] = value;
	if (index == APU_PARAMETER_SLOT_INDEX) {
		latch.m_selectedSlotLatch.refresh(value & APU_SLOT_INDEX_MASK);
	}
}

void ApuCommandLatch::clear() {
	m_registerWords.fill(0u);
	m_registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX] = APU_RATE_STEP_Q16_ONE;
	m_registerWords[APU_PARAMETER_GAIN_Q12_INDEX] = APU_GAIN_Q12_ONE;
	m_registerWords[APU_PARAMETER_FILTER_B0_B1_INDEX] = APU_FILTER_COEFFICIENT_ONE;
	m_registerWords[APU_PARAMETER_GENERATOR_KIND_INDEX] = APU_GENERATOR_NONE;
	m_registerWords[APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX] = APU_GAIN_Q12_ONE / 2u;
	mirrorRegisters();
}

void ApuCommandLatch::restore(const ApuParameterRegisterWords& registerWords) {
	m_registerWords = registerWords;
	mirrorRegisters();
}

void ApuCommandLatch::mirrorRegisters() {
	for (u32 index = 0u; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index], m_registerWords[index]);
	}
	m_memory.writeIoU32(IO_APU_CMD, APU_CMD_NONE);
	m_selectedSlotLatch.refresh(m_registerWords[APU_PARAMETER_SLOT_INDEX] & APU_SLOT_INDEX_MASK);
}

} // namespace bmsx
