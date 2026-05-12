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

void DeviceStatusLatch::restore(uint32_t restoredStatus, uint32_t restoredCode, uint32_t restoredDetail) const {
	status = restoredStatus;
	code = restoredCode;
	detail = restoredDetail;
	writeRegisterState();
}

void DeviceStatusLatch::writeRegisterState() const {
	m_memory.writeIoValue(m_registers.statusAddr, valueNumber(static_cast<double>(status)));
	m_memory.writeIoValue(m_registers.codeAddr, valueNumber(static_cast<double>(code)));
	m_memory.writeIoValue(m_registers.detailAddr, valueNumber(static_cast<double>(detail)));
	m_memory.writeIoValue(m_registers.ackAddr, valueNumber(0.0));
}

void DeviceStatusLatch::clear() const {
	code = m_registers.noneCode;
	detail = 0u;
	m_memory.writeIoValue(m_registers.codeAddr, valueNumber(static_cast<double>(code)));
	m_memory.writeIoValue(m_registers.detailAddr, valueNumber(static_cast<double>(detail)));
	setStatusFlag(m_registers.faultMask, false);
}

void DeviceStatusLatch::acknowledge() const {
	if (m_memory.readIoU32(m_registers.ackAddr) == 0u) {
		return;
	}
	clear();
	m_memory.writeIoValue(m_registers.ackAddr, valueNumber(0.0));
}

void DeviceStatusLatch::setStatusFlag(uint32_t mask, bool active) const {
	const uint32_t nextStatus = active ? (status | mask) : (status & ~mask);
	if (nextStatus == status) {
		return;
	}
	status = nextStatus;
	m_memory.writeIoValue(m_registers.statusAddr, valueNumber(static_cast<double>(status)));
}

void DeviceStatusLatch::raise(uint32_t raisedCode, uint32_t raisedDetail) const {
	if ((status & m_registers.faultMask) != 0u) {
		return;
	}
	code = raisedCode;
	detail = raisedDetail;
	m_memory.writeIoValue(m_registers.codeAddr, valueNumber(static_cast<double>(code)));
	m_memory.writeIoValue(m_registers.detailAddr, valueNumber(static_cast<double>(detail)));
	setStatusFlag(m_registers.faultMask, true);
}

} // namespace bmsx
