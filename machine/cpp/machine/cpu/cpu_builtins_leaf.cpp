#include "machine/cpu/cpu.h"

#include "machine/common/numeric.h"

namespace bmsx {

// These primitive cores do not allocate, write guest RAM or execute guest
// code. The ordinary CALL owner handles argument errors and cycle charges.
bool CPU::executeBuiltinLeaf(BuiltinFunctionId id, BuiltinArgsView args, Value& result) noexcept {
	switch (id) {
	case BuiltinFunctionId::ToInteger: {
		i32 integer;
		result = valueToInteger(args[0], integer) ? valueInteger(integer) : valueNil();
		return true;
	}
	case BuiltinFunctionId::GetMetatable: {
		const Value target = args[0];
		if (!valueIsTable(target)) return false;
		const u32 metatable = TableRecord(m_heap, valuePayload(target)).metatableAddress();
		result = metatable ? valueTable(metatable) : valueNil();
		return true;
	}
	case BuiltinFunctionId::StringByte: {
		const Value sourceValue = args[0];
		if (!valueIsString(sourceValue)) return false;
		int position = 1;
		if (args.size() > 1) {
			const Value positionValue = args[1];
			if (!isNil(positionValue)) {
				u32 word;
				if (!valueToWord(positionValue, word)) return false;
				position = static_cast<i32>(word);
			}
		}
		const StringId sourceId = asStringId(sourceValue);
		result = position < 1 || position > m_stringPool.byteLength(sourceId) ? valueNil()
			: valueInteger(static_cast<i32>(m_stringPool.byteAt(sourceId, static_cast<size_t>(position - 1))));
		return true;
	}
	default:
		return false;
	}
}

} // namespace bmsx
