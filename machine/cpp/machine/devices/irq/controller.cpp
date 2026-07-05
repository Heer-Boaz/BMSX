#include "machine/devices/irq/controller.h"
#include "machine/bus/io.h"

namespace bmsx {

IrqController::IrqController(Memory& memory)
	: m_memory(memory) {
	m_memory.mapIoRead(IO_IRQ_FLAGS, this, &IrqController::onFlagsReadThunk);
	m_memory.mapIoWrite(IO_IRQ_ACK, this, &IrqController::onAckWriteThunk);
	m_memory.mapIoRead(IO_IRQ_MASK, this, &IrqController::onMaskReadThunk);
	m_memory.mapIoWrite(IO_IRQ_MASK, this, &IrqController::onMaskWriteThunk);
}

void IrqController::reset() {
	m_pendingFlags = 0;
	m_mask = 0;
	m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
	m_memory.writeIoValue(IO_IRQ_MASK, valueNumber(0.0));
}

void IrqController::postLoad() {
	const Value clearAck = valueNumber(0.0);
	m_memory.writeIoValue(IO_IRQ_ACK, clearAck);
	m_memory.writeIoValue(IO_IRQ_MASK, valueNumber(static_cast<double>(m_mask)));
}

void IrqController::raise(uint32_t mask) {
	const uint32_t next = m_pendingFlags | mask;
	if (next != m_pendingFlags) {
		m_pendingFlags = next;
	}
}

void IrqController::acknowledge(uint32_t mask) {
	if (mask != 0u) {
		const uint32_t next = m_pendingFlags & ~mask;
		if (next != m_pendingFlags) {
			m_pendingFlags = next;
		}
	}
	m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

Value IrqController::onFlagsReadThunk(void* context, [[maybe_unused]] uint32_t addr) {
	return valueNumber(static_cast<double>(static_cast<IrqController*>(context)->m_pendingFlags));
}

void IrqController::onAckWriteThunk(void* context, [[maybe_unused]] uint32_t addr, Value value) {
	auto& irq = *static_cast<IrqController*>(context);
	const uint32_t mask = toU32(value);
	if (mask != 0u) {
		const uint32_t next = irq.m_pendingFlags & ~mask;
		if (next != irq.m_pendingFlags) {
			irq.m_pendingFlags = next;
		}
	}
	irq.m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

Value IrqController::onMaskReadThunk(void* context, [[maybe_unused]] uint32_t addr) {
	return valueNumber(static_cast<double>(static_cast<IrqController*>(context)->m_mask));
}

void IrqController::onMaskWriteThunk(void* context, [[maybe_unused]] uint32_t addr, Value value) {
	static_cast<IrqController*>(context)->m_mask = toU32(value);
}

} // namespace bmsx
