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
	Blua32DecodedExecutionImage reset();
	std::optional<Blua32DecodedExecutionImage> resolveDomain(int executionDomainId);
	std::optional<Blua32DecodedExecutionImage> reloadDomain(int executionDomainId) const;

private:
	std::optional<Blua32DecodedExecutionImage> decodeDomain(int executionDomainId) const;

	Memory& m_memory;
	uint8_t m_resolvedDomainMask = 0;
};

} // namespace bmsx
