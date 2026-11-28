#pragma once

#include "common/primitives.h"

namespace bmsx {

using ExecutionDomainId = i32;
constexpr ExecutionDomainId SYSTEM_EXECUTION_DOMAIN_ID = -1;
constexpr u32 EXECUTION_DOMAIN_COUNT = 3u;

// Operand table addresses per physical domain, in main RAM.
constexpr u32 EXECUTION_IMAGE_BINDINGS_OFFSET = 0x003fc200u;
constexpr u32 EXECUTION_IMAGE_BINDING_SIZE = 16u;
constexpr u32 EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET = 0u;
constexpr u32 EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET = 4u;
constexpr u32 EXECUTION_IMAGE_BINDING_STRINGS_OFFSET = 8u;

// Physical namespace descriptors, shared with the firmware's namespace_bank.
constexpr u32 SYSTEM_GLOBAL_BANK_OFFSET = 0x230u;
constexpr u32 GLOBAL_BANK_OFFSET = 0x23cu;
enum class GlobalBankField : u32 { Values = 0, Capacity = 4, Count = 8 };

constexpr u32 executionImageBindingOffset(ExecutionDomainId domain) {
	return EXECUTION_IMAGE_BINDINGS_OFFSET + EXECUTION_IMAGE_BINDING_SIZE * static_cast<u32>(domain + 1);
}

using ExecutionDomainMask = u32;
constexpr ExecutionDomainMask SYSTEM_EXECUTION_DOMAIN_MASK = 0x1u;
constexpr ExecutionDomainMask ALL_EXECUTION_DOMAINS_MASK = 0x7u;

constexpr ExecutionDomainMask executionDomainBit(ExecutionDomainId executionDomainId) {
	return 1u << static_cast<u32>(executionDomainId + 1);
}

} // namespace bmsx
