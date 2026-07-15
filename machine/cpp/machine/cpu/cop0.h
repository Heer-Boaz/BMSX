#pragma once

#include "common/types.h"

namespace bmsx {

constexpr u8 COP0_BAD_ADDRESS = 8u;
constexpr u8 COP0_STATUS = 12u;
constexpr u8 COP0_CAUSE = 13u;
constexpr u8 COP0_EPC = 14u;

constexpr u32 CPU_STATUS_INTERRUPT_ENABLE_CURRENT = 1u << 0u;
constexpr u32 CPU_STATUS_USER_MODE_CURRENT = 1u << 1u;
constexpr u32 CPU_STATUS_MODE_STACK_MASK = 0x3fu;
constexpr u32 CPU_STATUS_RFE_RESTORE_MASK = 0x0fu;

constexpr u32 CPU_STATUS_SYSTEM_ENTRY = CPU_STATUS_INTERRUPT_ENABLE_CURRENT;
constexpr u32 CPU_STATUS_CART_ENTRY = CPU_STATUS_INTERRUPT_ENABLE_CURRENT | CPU_STATUS_USER_MODE_CURRENT;

constexpr u32 CPU_CAUSE_IRQ = 1u << 10u;
constexpr u32 CPU_CAUSE_NMI = 1u << 16u;
constexpr u32 CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE = 11u << 2u;

} // namespace bmsx
