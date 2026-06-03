#pragma once

#include "machine/cpu/cpu.h"
#include <string>
#include <variant>

namespace bmsx {

struct NativeBridgeString {
	std::string value;
};

struct NativeBridgeTable {
	Table* value = nullptr;
};

struct NativeBridgeFunction {
	Value value = valueNil();
};

struct NativeBridgeObject {
	NativeObject* value = nullptr;
};

using NativeBridgeValue = std::variant<std::monostate, bool, double, NativeBridgeString, NativeBridgeTable, NativeBridgeFunction, NativeBridgeObject>;

NativeBridgeValue nativeBridgeValueFromRuntimeValue(Value value, const StringPool& strings);
Value runtimeValueFromNativeBridgeValue(CPU& cpu, const NativeBridgeValue& value);
const char* nativeBridgeValueTypeName(const NativeBridgeValue& value);

} // namespace bmsx
