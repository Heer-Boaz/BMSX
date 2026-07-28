#include "machine/cpu/value.h"

#include <cmath>

#include "common/number_format.h"

namespace bmsx {

std::string valueToString(Value value, const StringPool& stringPool) {
	if (isNil(value)) return "nil";
	if (valueIsTagged(value)) {
		switch (valueTag(value)) {
			case ValueTag::False: return "false";
			case ValueTag::True: return "true";
			case ValueTag::String: return stringPool.toString(asStringId(value));
			case ValueTag::Table: return "table";
			case ValueTag::Closure: return "function";
			case ValueTag::BuiltinFunction: return "function";
			case ValueTag::Upvalue: return "upvalue";
			case ValueTag::Nil: return "nil";
			default: return "unknown";
		}
	}
	const double number = asNumber(value);
	if (!std::isfinite(number)) {
		return std::isnan(number) ? "nan" : (number < 0 ? "-inf" : "inf");
	}
	return formatNumber(number);
}

} // namespace bmsx
