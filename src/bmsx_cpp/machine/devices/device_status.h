#pragma once

#include "common/primitives.h"
#include "machine/memory/memory.h"

namespace bmsx {

struct DeviceStatusRegisters {
	uint32_t statusAddr = 0;
	uint32_t codeAddr = 0;
	uint32_t detailAddr = 0;
	uint32_t ackAddr = 0;
	uint32_t faultMask = 0;
	uint32_t noneCode = 0;
};

class DeviceStatusLatch {
public:
	DeviceStatusLatch(Memory& memory, DeviceStatusRegisters registers);

	void resetStatus() const;
	void restore(uint32_t status, uint32_t code, uint32_t detail) const;
	void clear() const;
	void acknowledge() const;
	void setStatusFlag(uint32_t mask, bool active) const;
	void raise(uint32_t code, uint32_t detail) const;
	static void acknowledgeWriteThunk(void* context, uint32_t addr, Value value);

	mutable uint32_t status = 0;
	mutable uint32_t code = 0;
	mutable uint32_t detail = 0;

private:
	void writeRegisterState() const;

	Memory& m_memory;
	DeviceStatusRegisters m_registers;
};

} // namespace bmsx
