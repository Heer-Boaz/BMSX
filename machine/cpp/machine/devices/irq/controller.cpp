#include "machine/devices/irq/controller.h"
#include "spec/bmsx/io.h"

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
	m_userPendingFlags = 0;
	m_userMask = 0;
	m_supervisorContextActive = false;
	m_memory.writeIoU32(IO_IRQ_ACK, 0u);
	m_memory.writeIoU32(IO_IRQ_MASK, 0u);
}

void IrqController::postLoad() {
	m_memory.writeIoU32(IO_IRQ_ACK, 0u);
	m_memory.writeIoU32(IO_IRQ_MASK, m_mask);
}

void IrqController::raise(uint32_t mask) {
	const uint32_t next = m_pendingFlags | mask;
	if (next != m_pendingFlags) {
		m_pendingFlags = next;
	}
}

void IrqController::raiseUser(uint32_t mask) {
	if (!m_supervisorContextActive) {
		raise(mask);
		return;
	}
	m_userPendingFlags |= mask;
}

void IrqController::enterSupervisorContext() {
	m_userPendingFlags = m_pendingFlags;
	m_userMask = m_mask;
	m_supervisorContextActive = true;
	m_pendingFlags = 0u;
	m_mask = 0u;
	postLoad();
}

void IrqController::leaveSupervisorContext() {
	m_pendingFlags = m_userPendingFlags;
	m_mask = m_userMask;
	m_userPendingFlags = 0u;
	m_userMask = 0u;
	m_supervisorContextActive = false;
	postLoad();
}

void IrqController::acknowledge(uint32_t mask) {
	if (mask != 0u) {
		const uint32_t next = m_pendingFlags & ~mask;
		if (next != m_pendingFlags) {
			m_pendingFlags = next;
		}
	}
	m_memory.writeIoU32(IO_IRQ_ACK, 0u);
}

u32 IrqController::onFlagsReadThunk(void* context, [[maybe_unused]] uint32_t addr, MappedBusSignals) {
	return static_cast<IrqController*>(context)->m_pendingFlags;
}

void IrqController::onAckWriteThunk(void* context, [[maybe_unused]] uint32_t addr, u32 value, MappedBusSignals) {
	auto& irq = *static_cast<IrqController*>(context);
	if (value != 0u) {
		const uint32_t next = irq.m_pendingFlags & ~value;
		if (next != irq.m_pendingFlags) {
			irq.m_pendingFlags = next;
		}
	}
	irq.m_memory.writeIoU32(IO_IRQ_ACK, 0u);
}

u32 IrqController::onMaskReadThunk(void* context, [[maybe_unused]] uint32_t addr, MappedBusSignals) {
	return static_cast<IrqController*>(context)->m_mask;
}

void IrqController::onMaskWriteThunk(void* context, [[maybe_unused]] uint32_t addr, u32 value, MappedBusSignals) {
	static_cast<IrqController*>(context)->m_mask = value;
}

} // namespace bmsx
