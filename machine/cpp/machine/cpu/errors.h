#pragma once

#include "common/primitives.h"
#include "spec/blua32/cop0.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct LuaOutOfMemorySignal final {};

struct LuaThrownValueError final {
	Value value = valueNil();
	explicit LuaThrownValueError(Value value) : value(value) {}
};

struct LuaExecutionError final {
	u32 reason;
	explicit LuaExecutionError(u32 reason = LUA_FAULT_REASON_UNKNOWN) : reason(reason) {}
};

} // namespace bmsx
