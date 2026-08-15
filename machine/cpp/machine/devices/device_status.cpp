#include "machine/devices/device_status.h"

namespace bmsx {

DeviceStatusLatch::DeviceStatusLatch(Memory& memory, DeviceStatusRegisters registers)
	: code(registers.noneCode)
	, m_memory(memory)
	, m_registers(registers) {
	detail = 0u;
}

void DeviceStatusLatch::resetStatus() const {
	status = 0u;
	code = m_registers.noneCode;
	detail = 0u;
	writeRegisterState();
}

void DeviceStatusLatch::restore(uint32_t status, uint32_t code, uint32_t detail) const {
	this->status = status;
	this->code = code;
	this->detail = detail;
	writeRegisterState();
}

void DeviceStatusLatch::writeRegisterState() const {
	m_memory.writeIoU32(m_registers.statusAddr, status);
	m_memory.writeIoU32(m_registers.codeAddr, code);
	m_memory.writeIoU32(m_registers.detailAddr, detail);
	m_memory.writeIoU32(m_registers.ackAddr, 0u);
}

void DeviceStatusLatch::setStatusFlag(uint32_t mask, bool active) const {
	const uint32_t nextStatus = active ? (status | mask) : (status & ~mask);
	if (nextStatus == status) {
		return;
	}
	status = nextStatus;
	m_memory.writeIoU32(m_registers.statusAddr, status);
}

void DeviceStatusLatch::raise(uint32_t code, uint32_t detail) const {
	if ((status & m_registers.faultMask) != 0u) {
		return;
	}
	this->code = code;
	this->detail = detail;
	m_memory.writeIoU32(m_registers.codeAddr, code);
	m_memory.writeIoU32(m_registers.detailAddr, detail);
	setStatusFlag(m_registers.faultMask, true);
}

void DeviceStatusLatch::acknowledgeWriteThunk(void* context, uint32_t, u32 value, MappedBusSignals) {
	if (value == 0u) {
		return;
	}
	auto* latch = static_cast<DeviceStatusLatch*>(context);
	latch->code = latch->m_registers.noneCode;
	latch->detail = 0u;
	latch->m_memory.writeIoU32(latch->m_registers.codeAddr, latch->code);
	latch->m_memory.writeIoU32(latch->m_registers.detailAddr, latch->detail);
	latch->setStatusFlag(latch->m_registers.faultMask, false);
	latch->m_memory.writeIoU32(latch->m_registers.ackAddr, 0u);
}

} // namespace bmsx
