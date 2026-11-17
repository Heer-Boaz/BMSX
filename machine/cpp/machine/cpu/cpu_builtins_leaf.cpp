#include "machine/cpu/cpu.h"

#include "machine/common/numeric.h"

namespace bmsx {

// These primitive cores neither allocate nor execute guest code. A rejected
// argument leaves both the result and the guest state untouched; the ordinary
// call owner supplies its existing argument error and primitive charge.
bool CPU::executeBuiltinLeaf(BuiltinFunctionId id, BuiltinArgsView args, Value& result) noexcept {
	switch (id) {
	case BuiltinFunctionId::ToInteger: {
		i32 integer;
		result = valueToInteger(args[0], integer) ? valueInteger(integer) : valueNil();
		return true;
	}
	case BuiltinFunctionId::SetMetatable: {
		const Value target = args[0];
		if (!valueIsTable(target)) return false;
		const Value metatableValue = args[1];
		Table* metatable = nullptr;
		if (valueIsTable(metatableValue)) metatable = asTable(metatableValue, m_heap);
		else if (!isNil(metatableValue)) return false;
		asTable(target, m_heap)->writeBarrier();
		asTable(target, m_heap)->metatable = metatable;
		result = target;
		return true;
	}
	case BuiltinFunctionId::GetMetatable: {
		const Value target = args[0];
		if (!valueIsTable(target)) return false;
		Table* metatable = asTable(target, m_heap)->metatable;
		result = metatable ? valueTable(m_heap.reference(metatable)) : valueNil();
		return true;
	}
	case BuiltinFunctionId::StringByte: {
		const Value sourceValue = args[0];
		if (!valueIsString(sourceValue)) return false;
		int position = 1;
		if (args.size() > 1) {
			const Value positionValue = args[1];
			if (!isNil(positionValue)) {
				i32 integer;
				if (!valueToInteger(positionValue, integer)) return false;
				position = integer;
			}
		}
		const StringId sourceId = asStringId(sourceValue);
		result = position < 1 || position > m_stringPool.codepointCount(sourceId) ? valueNil()
			: valueInteger(static_cast<i32>(m_stringPool.codepointAt(sourceId, static_cast<size_t>(position - 1))));
		return true;
	}
	default:
		return false;
	}
}

} // namespace bmsx
