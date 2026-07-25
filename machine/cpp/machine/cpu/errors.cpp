#include "machine/cpu/errors.h"

namespace bmsx {

LuaThrownValueError::LuaThrownValueError(Value value, const StringPool& stringPool)
	: value(value)
	, message(valueToString(value, stringPool)) {}

} // namespace bmsx
