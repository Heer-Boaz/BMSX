#pragma once

#include "common/primitives.h"
#include "machine/cpu/blua32_image.h"

#include <optional>

namespace bmsx {

class Memory;

constexpr int SYSTEM_EXECUTION_DOMAIN_ID = -1;

struct Blua32DecodedExecutionImage {
	Blua32ImageLayout layout;
	int executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 startupFunctionAddress = 0;
	u32 irqFunctionAddress = 0;
	u32 exceptionFunctionAddress = 0;
};

class ExecutionAddressSpace {
public:
	explicit ExecutionAddressSpace(Memory& memory)
		: m_memory(memory) {
	}

	std::optional<int> domainIdOnBus(u32 address) const;
	Blua32DecodedExecutionImage resolveSystemDomain() const;
	std::optional<Blua32DecodedExecutionImage> resolveDomain(int executionDomainId) const;

private:
	Memory& m_memory;
};

} // namespace bmsx
