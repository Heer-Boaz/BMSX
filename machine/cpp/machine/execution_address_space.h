#pragma once

#include "common/primitives.h"
#include "machine/memory/bus_signals.h"
#include "spec/blua32/execution_domain.h"

#include <optional>

namespace bmsx {

class Memory;

struct Blua32ExecutionBoot {
	u32 imageAddress = 0;
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 startupFunctionAddress = 0;
	u32 irqFunctionAddress = 0;
	u32 exceptionFunctionAddress = 0;
};

class ExecutionAddressSpace {
public:
	explicit ExecutionAddressSpace(Memory& memory)
		: m_memory(memory) {
	}

	std::optional<ExecutionDomainId> domainIdOnBus(
		u32 address,
		MappedBusSignals busSignals
	) const;
	void bindReadOnlyView(
		ExecutionDomainId executionDomainId,
		u32 address,
		size_t byteCount,
		Span<const u8>& out
	) const;
	Blua32ExecutionBoot resolveSystemDomain() const;
	std::optional<Blua32ExecutionBoot> resolveDomain(ExecutionDomainId executionDomainId) const;

private:
	Memory& m_memory;
};

} // namespace bmsx
