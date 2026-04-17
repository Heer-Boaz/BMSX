#include "machine/devices/irq/irq_controller.h"
#include "machine/bus/io.h"

namespace bmsx {

IrqController::IrqController(Memory& memory)
	: m_memory(memory) {
	m_memory.mapIoWrite(IO_IRQ_ACK, this, &IrqController::onAckWriteThunk);
}

void IrqController::reset() {
	m_signalSequence = 0;
	m_memory.writeIoValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

void IrqController::postLoad() {
	m_signalSequence = 0;
	m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

uint32_t IrqController::pendingFlags() const {
	return m_memory.readIoU32(IO_IRQ_FLAGS);
}

void IrqController::raise(uint32_t mask) {
	const uint32_t current = m_memory.readIoU32(IO_IRQ_FLAGS);
	const uint32_t next = current | mask;
	m_memory.writeIoValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(next)));
	if (next != current) {
		m_signalSequence += 1;
	}
}

void IrqController::acknowledge(uint32_t mask) {
	if (mask != 0u) {
		const uint32_t flags = m_memory.readIoU32(IO_IRQ_FLAGS) & ~mask;
		m_memory.writeIoValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(flags)));
	}
	m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

void IrqController::onAckWriteThunk(void* context, uint32_t, Value) {
	static_cast<IrqController*>(context)->onAckWrite();
}

void IrqController::onAckWrite() {
	acknowledge(m_memory.readIoU32(IO_IRQ_ACK));
}

} // namespace bmsx
