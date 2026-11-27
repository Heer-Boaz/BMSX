#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint8_t COP0_BAD_ADDRESS = 8u;
constexpr uint8_t COP0_LUA_FAULT_REASON = 9u;
constexpr uint8_t COP0_STATUS = 12u;
constexpr uint8_t COP0_CAUSE = 13u;
constexpr uint8_t COP0_EPC = 14u;
constexpr uint8_t COP0_EXEC = 15u;
constexpr uint8_t COP0_CONTEXT = 16u;
constexpr uint8_t COP0_RAM_END = 17u;
constexpr uint8_t COP0_SYSTEM_VECTOR = 18u;
constexpr uint8_t COP0_PREVIOUS_ACTIVE = 19u;
constexpr uint8_t COP0_EXCEPTION_TARGET = 20u;
constexpr uint8_t COP0_IRQ_VECTOR = 21u;
constexpr uint8_t COP0_CURRENT = 22u;
// Only the target control word carries a physical socket; execution PCs stay mapped addresses.
constexpr uint32_t CPU_EXCEPTION_TARGET_SOCKET_SHIFT = 31u;
constexpr uint32_t CPU_EXCEPTION_TARGET_ADDRESS_MASK = 0x7fffffffu;
constexpr uint32_t CPU_INTERRUPT_STATE_HALT = 0x80000000u;

constexpr bool cop0ReadAsZero(int field) { return field == COP0_EXEC || field == COP0_RAM_END || field == COP0_EXCEPTION_TARGET || field == COP0_IRQ_VECTOR; }
constexpr bool cop0WriteRetiresControl(int field) {
	return field == COP0_STATUS || field == COP0_EXEC || field == COP0_CONTEXT
		|| field == COP0_RAM_END || field == COP0_SYSTEM_VECTOR || field == COP0_EXCEPTION_TARGET || field == COP0_IRQ_VECTOR
		|| field == COP0_CURRENT;
}

constexpr bool cop0FieldImplemented(int field) {
	constexpr uint32_t fields = (1u << COP0_BAD_ADDRESS) | (1u << COP0_LUA_FAULT_REASON)
		| (1u << COP0_STATUS) | (1u << COP0_CAUSE) | (1u << COP0_EPC) | (1u << COP0_EXEC) | (1u << COP0_CONTEXT) | (1u << COP0_RAM_END) | (1u << COP0_SYSTEM_VECTOR) | (1u << COP0_PREVIOUS_ACTIVE) | (1u << COP0_EXCEPTION_TARGET) | (1u << COP0_IRQ_VECTOR) | (1u << COP0_CURRENT);
	return static_cast<uint32_t>(field) <= COP0_CURRENT && ((fields >> field) & 1u) != 0u;
}

constexpr uint32_t CPU_STATUS_INTERRUPT_ENABLE_CURRENT = 1u << 0u;
constexpr uint32_t CPU_STATUS_USER_MODE_CURRENT = 1u << 1u;
constexpr uint32_t CPU_STATUS_MODE_STACK_MASK = 0x3fu;
constexpr uint32_t CPU_STATUS_RFE_RESTORE_MASK = 0x0fu;
constexpr uint32_t CPU_STATUS_INHIBIT_RESET = 1u << 8u;

constexpr uint32_t CPU_STATUS_SYSTEM_ENTRY = CPU_STATUS_INTERRUPT_ENABLE_CURRENT;
constexpr uint32_t CPU_STATUS_CART_ENTRY = CPU_STATUS_INTERRUPT_ENABLE_CURRENT | CPU_STATUS_USER_MODE_CURRENT;

constexpr uint32_t CPU_CAUSE_IRQ = 1u << 10u;
constexpr uint32_t CPU_CAUSE_NMI = 1u << 16u;
constexpr uint32_t CPU_CAUSE_CODE_MASK = 0x7cu;
constexpr uint32_t CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD = 4u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_ADDRESS_ERROR_STORE = 5u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR = 6u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_DATA_BUS_ERROR = 7u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_SYSCALL = 8u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_RESERVED_INSTRUCTION = 10u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE = 11u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_TRAP = 13u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_REGISTER_WINDOW = 14u << 2u;
constexpr uint32_t CPU_CAUSE_CODE_REFERENCE_STORE = 15u << 2u;

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
constexpr uint32_t LUA_FAULT_REASON_INVALID_NEXT_KEY = 11u;
constexpr uint32_t LUA_FAULT_REASON_INDEX_NAN = 12u;

} // namespace bmsx
