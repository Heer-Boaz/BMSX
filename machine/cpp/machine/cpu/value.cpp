#include "machine/cpu/value.h"
#include "common/number_format.h"

namespace bmsx {
void appendValueString(std::string& out, Value value, const StringPool& strings) {
	switch (valueTag(value)) {
		case ValueTag::Integer: out.append(formatInteger(asInteger(value))); break;
		case ValueTag::Float: out.append(formatFloat(asFloat(value))); break;
		case ValueTag::Nil: out.append("nil"); break;
		case ValueTag::False: out.append("false"); break;
		case ValueTag::True: out.append("true"); break;
		case ValueTag::String: strings.appendBytes(out, asStringId(value)); break;
		case ValueTag::Table: out.append("table"); break;
		case ValueTag::Thread: out.append("thread"); break;
		case ValueTag::Closure: case ValueTag::BuiltinFunction: case ValueTag::ResidentFunction: case ValueTag::CodeFunction: out.append("function"); break;
		default: BMSX_UNREACHABLE();
	}
}
std::string valueToString(Value value, const StringPool& strings) {
	std::string out; appendValueString(out, value, strings); return out;
}
} // namespace bmsx
