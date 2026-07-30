#include "machine/cpu/value.h"

#include <cmath>

#include "common/number_format.h"

namespace bmsx {

std::string valueToString(Value value, const StringPool& stringPool) {
	const uint8_t encodedTag = valueEncodedTag(value);
	if (encodedTag != 0) {
		switch (static_cast<ValueTag>(encodedTag - 1u)) {
			case ValueTag::Nil: return "nil";
			case ValueTag::False: return "false";
			case ValueTag::True: return "true";
			case ValueTag::String: return stringPool.toString(asStringId(value));
			case ValueTag::Table: return "table";
			case ValueTag::Closure:
			case ValueTag::BuiltinFunction: return "function";
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
