#include "machine/cpu/value_slots.h"

#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void checkKinds() {
	ValueSlots slots(1);
	for (const auto kind : {ValueTag::Nil, ValueTag::False, ValueTag::True, ValueTag::Integer, ValueTag::Float,
		ValueTag::String, ValueTag::Table, ValueTag::Closure, ValueTag::BuiltinFunction, ValueTag::Thread, ValueTag::DeadKey}) {
		for (uint32_t payload : {0u, 1u, 0x80000000u, 0x7fc00001u, 0xffffffffu}) {
			*slots.tags() = static_cast<uint8_t>(kind);
			*slots.words() = payload;
			const Value v = slots.get(0);
			if (valueTag(v) != kind || valuePayload(v) != payload || v != valueFromTag(kind, payload)
				|| valueIsNumber(v) != (kind == ValueTag::Integer || kind == ValueTag::Float)
				|| valueIsInteger(v) != (kind == ValueTag::Integer) || valueIsFloat(v) != (kind == ValueTag::Float)
				|| isNil(v) != (kind == ValueTag::Nil) || isTruthy(v) != (kind != ValueTag::Nil && kind != ValueTag::False)
				|| valueIsBool(v) != (kind == ValueTag::False || kind == ValueTag::True) || valueToBool(v) != (kind == ValueTag::True)
				|| valueIsString(v) != (kind == ValueTag::String) || valueIsTable(v) != (kind == ValueTag::Table)
				|| valueIsClosure(v) != (kind == ValueTag::Closure) || valueIsThread(v) != (kind == ValueTag::Thread)
				|| valueIsBuiltinFunction(v) != (kind == ValueTag::BuiltinFunction))
				throw std::runtime_error("Classification must follow the tag plane, not the payload");
		}
	}
}
}
int main() {
	try { checkKinds(); std::cout << "Value classification tests passed\n"; return 0; }
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
