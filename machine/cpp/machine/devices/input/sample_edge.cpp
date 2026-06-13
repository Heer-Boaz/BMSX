#include "machine/devices/input/sample_edge.h"

#include "machine/bus/io.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"
#include "machine/memory/memory.h"

namespace bmsx {

InputControllerSampleEdge::InputControllerSampleEdge(InputControllerInputSource& input, InputControllerSampleLatch& sampleLatch, InputControllerRegisterFile& registers, Memory& memory)
	: m_input(input)
	, m_sampleLatch(sampleLatch)
	, m_registers(registers)
	, m_memory(memory) {}

void InputControllerSampleEdge::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleLatch.consumeVblankEdge(nowCycles)) {
		return;
	}
	m_input.sampleInputControllerSnapshot(currentTimeMs, m_snapshot);
	m_registers.latchSnapshot(m_snapshot);
	m_registers.mirror(m_memory);
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleLatch.sequence())));
}

} // namespace bmsx
