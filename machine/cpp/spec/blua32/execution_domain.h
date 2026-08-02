#pragma once

#include "common/primitives.h"

namespace bmsx {

using ExecutionDomainId = i32;
constexpr ExecutionDomainId SYSTEM_EXECUTION_DOMAIN_ID = -1;

using ExecutionDomainMask = u32;
constexpr ExecutionDomainMask SYSTEM_EXECUTION_DOMAIN_MASK = 0x1u;
constexpr ExecutionDomainMask ALL_EXECUTION_DOMAINS_MASK = 0x7u;

constexpr ExecutionDomainMask executionDomainBit(ExecutionDomainId executionDomainId) {
	return 1u << static_cast<u32>(executionDomainId + 1);
}

} // namespace bmsx
