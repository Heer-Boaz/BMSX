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

Value IrqController::onFlagsReadThunk(void* context, uint32_t) {
	const auto* controller = static_cast<IrqController*>(context);
	return controller->onFlagsRead();
}

void IrqController::onAckWriteThunk(void* context, uint32_t addr, Value value) {
	auto* controller = static_cast<IrqController*>(context);
	controller->onAckWrite(addr, value);
}

Value IrqController::onMaskReadThunk(void* context, uint32_t) {
	const auto* controller = static_cast<IrqController*>(context);
	return controller->onMaskRead();
}

void IrqController::onMaskWriteThunk(void* context, uint32_t addr, Value value) {
	auto* controller = static_cast<IrqController*>(context);
	controller->onMaskWrite(addr, value);
}

Value IrqController::onFlagsRead() const {
	return valueNumber(static_cast<double>(m_pendingFlags));
}

void IrqController::onAckWrite([[maybe_unused]] uint32_t addr, Value value) {
	const uint32_t mask = toU32(value);
	acknowledge(mask);
}

Value IrqController::onMaskRead() const {
	return valueNumber(static_cast<double>(m_mask));
}

void IrqController::onMaskWrite([[maybe_unused]] uint32_t addr, Value value) {
	m_mask = toU32(value);
}

} // namespace bmsx
