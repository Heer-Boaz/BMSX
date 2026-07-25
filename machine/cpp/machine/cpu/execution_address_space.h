#pragma once

#include "common/primitives.h"
#include "machine/cpu/blua32_image.h"

#include <optional>

namespace bmsx {

class Memory;

constexpr int SYSTEM_EXECUTION_DOMAIN_ID = -1;

struct Blua32DecodedExecutionImage {
	Blua32ImageLayout layout;
	Blua32BootHeader boot;
	int executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
};

class ExecutionAddressSpace {
public:
	explicit ExecutionAddressSpace(Memory& memory)
		: m_memory(memory) {
	}

	std::optional<int> domainIdOnBus(u32 address) const;
	std::optional<Blua32DecodedExecutionImage> loadDomain(int executionDomainId) const;

private:
	Memory& m_memory;
};

} // namespace bmsx
