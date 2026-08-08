#include "machine/cpu/value.h"

#include <cmath>

#include "common/number_format.h"

namespace bmsx {

void appendValueString(std::string& out, Value value, const StringPool& stringPool) {
	const uint8_t encodedTag = valueEncodedTag(value);
	if (encodedTag != 0) {
		switch (static_cast<ValueTag>(encodedTag - 1u)) {
			case ValueTag::Nil: out.append("nil"); return;
			case ValueTag::False: out.append("false"); return;
			case ValueTag::True: out.append("true"); return;
			case ValueTag::String: out.append(stringPool.toString(asStringId(value))); return;
			case ValueTag::Table: out.append("table"); return;
			case ValueTag::Closure:
			case ValueTag::BuiltinFunction: out.append("function"); return;
			default: __builtin_unreachable();
		}
	}
	const double number = asNumber(value);
	if (!std::isfinite(number)) {
		out.append(std::isnan(number) ? "nan" : (number < 0 ? "-inf" : "inf"));
		return;
	}
	out.append(formatNumber(number));
}

std::string valueToString(Value value, const StringPool& stringPool) {
	std::string out;
	appendValueString(out, value, stringPool);
	return out;
}

} // namespace bmsx
