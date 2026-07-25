#pragma once

#include <exception>
#include <stdexcept>
#include <string>

#include "common/primitives.h"
#include "machine/cpu/cop0.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct LuaThrownValueError final : std::exception {
	Value value = valueNil();
	std::string message;

	LuaThrownValueError(Value value, const StringPool& stringPool);
	const char* what() const noexcept override { return message.c_str(); }
};

struct LuaExecutionError final : std::runtime_error {
	u32 reason;
	explicit LuaExecutionError(const std::string& message, u32 reason = LUA_FAULT_REASON_UNKNOWN)
		: std::runtime_error(message), reason(reason) {}
};

} // namespace bmsx
