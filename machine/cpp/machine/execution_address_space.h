#pragma once

#include "common/primitives.h"

#include <optional>

namespace bmsx {

class Memory;

constexpr int SYSTEM_EXECUTION_DOMAIN_ID = -1;

struct Blua32ExecutionBoot {
	u32 imageAddress = 0;
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
	void bindReadOnlyView(
		int executionDomainId,
		u32 address,
		size_t byteCount,
		Span<const u8>& out
	) const;
	Blua32ExecutionBoot resolveSystemDomain() const;
	std::optional<Blua32ExecutionBoot> resolveDomain(int executionDomainId) const;

private:
	Memory& m_memory;
};

} // namespace bmsx
