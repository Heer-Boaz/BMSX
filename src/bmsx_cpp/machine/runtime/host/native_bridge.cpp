#include "machine/runtime/host/native_bridge.h"

namespace bmsx {

NativeBridgeValue nativeBridgeValueFromRuntimeValue(Value value, const StringPool& strings) {
	if (isNil(value)) {
		return std::monostate{};
	}
	if (valueIsBool(value)) {
		return valueToBool(value);
	}
	if (valueIsNumber(value)) {
		return asNumber(value);
	}
	if (valueIsString(value)) {
		return NativeBridgeString{ strings.toString(asStringId(value)) };
	}
	if (valueIsTable(value)) {
		return NativeBridgeTable{ asTable(value) };
	}
	if (valueIsClosure(value) || valueIsNativeFunction(value)) {
		return NativeBridgeFunction{ value };
	}
	if (valueIsNativeObject(value)) {
		return NativeBridgeObject{ asNativeObject(value) };
	}
	throw BMSX_RUNTIME_ERROR("Value cannot cross the native bridge.");
}

Value runtimeValueFromNativeBridgeValue(CPU& cpu, const NativeBridgeValue& value) {
	switch (value.index()) {
		case 0:
			return valueNil();
		case 1:
			return valueBool(std::get<bool>(value));
		case 2:
			return valueNumber(std::get<double>(value));
		case 3:
			return valueString(cpu.internString(std::get<NativeBridgeString>(value).value));
		case 4:
			return valueTable(std::get<NativeBridgeTable>(value).value);
		case 5:
			return std::get<NativeBridgeFunction>(value).value;
		case 6:
			return valueNativeObject(std::get<NativeBridgeObject>(value).value);
	}
	throw BMSX_RUNTIME_ERROR("Invalid native bridge value variant.");
}

const char* nativeBridgeValueTypeName(const NativeBridgeValue& value) {
	switch (value.index()) {
		case 0: return "nil";
		case 1: return "boolean";
		case 2: return "number";
		case 3: return "string";
		case 4: return "table";
		case 5: return "function";
		case 6: return "native";
	}
	throw BMSX_RUNTIME_ERROR("Invalid native bridge value variant.");
}

} // namespace bmsx
