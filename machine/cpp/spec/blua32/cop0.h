#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint8_t COP0_BAD_ADDRESS = 8u;
constexpr uint8_t COP0_LUA_FAULT_REASON = 9u;
constexpr uint8_t COP0_STATUS = 12u;
constexpr uint8_t COP0_CAUSE = 13u;
constexpr uint8_t COP0_EPC = 14u;
constexpr uint8_t COP0_EXEC = 15u;

constexpr uint32_t CPU_STATUS_INTERRUPT_ENABLE_CURRENT = 1u << 0u;
constexpr uint32_t CPU_STATUS_USER_MODE_CURRENT = 1u << 1u;
constexpr uint32_t CPU_STATUS_MODE_STACK_MASK = 0x3fu;
constexpr uint32_t CPU_STATUS_RFE_RESTORE_MASK = 0x0fu;

constexpr uint32_t CPU_STATUS_SYSTEM_ENTRY = CPU_STATUS_INTERRUPT_ENABLE_CURRENT;
constexpr uint32_t CPU_STATUS_CART_ENTRY = CPU_STATUS_INTERRUPT_ENABLE_CURRENT | CPU_STATUS_USER_MODE_CURRENT;

constexpr uint32_t CPU_CAUSE_IRQ = 1u << 10u;
constexpr uint32_t CPU_CAUSE_NMI = 1u << 16u;
constexpr uint32_t CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD = 4u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_ADDRESS_ERROR_STORE = 5u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_DATA_BUS_ERROR = 7u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE = 11u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_TRAP = 13u << 2u;

constexpr uint32_t LUA_FAULT_REASON_UNKNOWN = 0u;
constexpr uint32_t LUA_FAULT_REASON_CALL_NON_FUNCTION = 1u;
constexpr uint32_t LUA_FAULT_REASON_INDEX_NON_TABLE = 2u;
constexpr uint32_t LUA_FAULT_REASON_ASSIGN_NON_TABLE = 3u;
constexpr uint32_t LUA_FAULT_REASON_INDEX_NIL = 4u;
constexpr uint32_t LUA_FAULT_REASON_METATABLE_LOOP = 5u;
constexpr uint32_t LUA_FAULT_REASON_ITERATE_NON_TABLE = 6u;
constexpr uint32_t LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION = 7u;
constexpr uint32_t LUA_FAULT_REASON_EXPLICIT_ERROR = 8u;
constexpr uint32_t LUA_FAULT_REASON_OUT_OF_MEMORY = 9u;
constexpr uint32_t LUA_FAULT_REASON_INVALID_ARGUMENT = 10u;

} // namespace bmsx
