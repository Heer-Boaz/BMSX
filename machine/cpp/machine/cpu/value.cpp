#include "machine/cpu/value.h"

#include "common/compiler.h"

#include <cmath>

#include "common/number_format.h"

namespace bmsx {

int appendValueString(std::string& out, Value value, const StringPool& stringPool) {
	const uint8_t encodedTag = valueEncodedTag(value);
	if (encodedTag != 0) {
		switch (static_cast<ValueTag>(encodedTag - 1u)) {
			case ValueTag::Nil: out.append("nil"); return 3;
			case ValueTag::False: out.append("false"); return 5;
			case ValueTag::True: out.append("true"); return 4;
			case ValueTag::String: out.append(stringPool.toString(asStringId(value))); return stringPool.codepointCount(asStringId(value));
			case ValueTag::Table: out.append("table"); return 5;
			case ValueTag::Thread: out.append("thread"); return 6;
			case ValueTag::Closure:
			case ValueTag::BuiltinFunction: out.append("function"); return 8;
			default: BMSX_UNREACHABLE();
		}
	}
	const size_t previousLength = out.size();
	const double number = asNumber(value);
	if (!std::isfinite(number)) {
		out.append(std::isnan(number) ? "nan" : (number < 0 ? "-inf" : "inf"));
	} else {
		out.append(formatNumber(number));
	}
	return static_cast<int>(out.size() - previousLength);
}

std::string valueToString(Value value, const StringPool& stringPool) {
	std::string out;
	appendValueString(out, value, stringPool);
	return out;
}

} // namespace bmsx
