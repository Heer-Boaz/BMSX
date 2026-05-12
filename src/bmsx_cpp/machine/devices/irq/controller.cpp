#include "machine/devices/irq/controller.h"
#include "machine/bus/io.h"

namespace bmsx {

IrqController::IrqController(Memory& memory)
	: m_memory(memory) {
	m_memory.mapIoRead(IO_IRQ_FLAGS, this, &IrqController::onFlagsReadThunk);
	m_memory.mapIoWrite(IO_IRQ_ACK, this, &IrqController::onAckWriteThunk);
}

void IrqController::reset() {
	m_pendingFlags = 0;
	m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

void IrqController::postLoad() {
	const Value clearAck = valueNumber(0.0);
	m_memory.writeIoValue(IO_IRQ_ACK, clearAck);
}

IrqControllerState IrqController::captureState() const {
	return IrqControllerState{m_pendingFlags};
}

void IrqController::restoreState(const IrqControllerState& state) {
	m_pendingFlags = state.pendingFlags;
	postLoad();
}

void IrqController::raise(uint32_t mask) {
	const uint32_t next = m_pendingFlags | mask;
	if (next != m_pendingFlags) {
		m_pendingFlags = next;
	}
}

Value IrqController::onFlagsReadThunk(void* context, uint32_t) {
	const auto* controller = static_cast<IrqController*>(context);
	return valueNumber(static_cast<double>(controller->m_pendingFlags));
}

void IrqController::onAckWriteThunk(void* context, uint32_t, Value value) {
	auto* controller = static_cast<IrqController*>(context);
	const uint32_t ack = toU32(value);
	if (ack != 0u) {
		const uint32_t next = controller->m_pendingFlags & ~ack;
		if (next != controller->m_pendingFlags) {
			controller->m_pendingFlags = next;
		}
	}
	controller->m_memory.writeIoValue(IO_IRQ_ACK, valueNumber(0.0));
}

} // namespace bmsx
