#include "machine/cpu/value.h"
#include "common/number_format.h"

namespace bmsx {
int appendValueString(std::string& out, Value value, const StringPool& strings) {
	const size_t start = out.size();
	switch (valueTag(value)) {
		case ValueTag::Integer: out.append(formatInteger(asInteger(value))); break;
		case ValueTag::Float: out.append(formatFloat(asFloat(value))); break;
		case ValueTag::Nil: out.append("nil"); break;
		case ValueTag::False: out.append("false"); break;
		case ValueTag::True: out.append("true"); break;
		case ValueTag::String: strings.appendBytes(out, asStringId(value)); return strings.byteLength(asStringId(value));
		case ValueTag::Table: out.append("table"); break;
		case ValueTag::Thread: out.append("thread"); break;
		case ValueTag::Closure: case ValueTag::BuiltinFunction: out.append("function"); break;
		default: BMSX_UNREACHABLE();
	}
	return static_cast<int>(out.size() - start);
}
std::string valueToString(Value value, const StringPool& strings) {
	std::string out; appendValueString(out, value, strings); return out;
}
const char* valueTypeName(Value value) {
	switch (valueTag(value)) {
		case ValueTag::Nil: return "nil";
		case ValueTag::False: case ValueTag::True: return "boolean";
		case ValueTag::Integer: return "integer";
		case ValueTag::Float: return "float";
		case ValueTag::String: return "string";
		case ValueTag::Thread: return "thread";
		case ValueTag::Table: return "table";
		case ValueTag::Closure: return "closure";
		case ValueTag::BuiltinFunction: return "builtin_function";
		default: BMSX_UNREACHABLE();
	}
}
const char* valueTypeNameForLua(Value value) {
	switch (valueTag(value)) {
		case ValueTag::Integer: case ValueTag::Float: return "number";
		case ValueTag::Closure: case ValueTag::BuiltinFunction: return "function";
		default: return valueTypeName(value);
	}
}
} // namespace bmsx
