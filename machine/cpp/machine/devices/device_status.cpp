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

void DeviceStatusLatch::clear() const {
	code = m_registers.noneCode;
	detail = 0u;
	m_memory.writeIoU32(m_registers.codeAddr, code);
	m_memory.writeIoU32(m_registers.detailAddr, detail);
	setStatusFlag(m_registers.faultMask, false);
}

void DeviceStatusLatch::acknowledge() const {
	if (m_memory.readIoU32(m_registers.ackAddr) == 0u) {
		return;
	}
	clear();
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

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the device status latch owner.
void DeviceStatusLatch::acknowledgeWriteThunk(void* context, uint32_t, u32, MappedBusSignals) {
	static_cast<DeviceStatusLatch*>(context)->acknowledge();
}

} // namespace bmsx
