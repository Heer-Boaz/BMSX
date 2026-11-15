#include "machine/cpu/cpu.h"

#include "machine/common/numeric.h"

namespace bmsx {

// These primitive cores neither allocate nor execute guest code. A rejected
// argument leaves both the result and the guest state untouched; the ordinary
// call owner supplies its existing argument error and primitive charge.
bool CPU::executeBuiltinLeaf(BuiltinFunctionId id, BuiltinArgsView args, Value& result) noexcept {
	switch (id) {
	case BuiltinFunctionId::SetMetatable: {
		const Value target = args[0];
		if (!valueIsTable(target)) return false;
		const Value metatableValue = args[1];
		Table* metatable = nullptr;
		if (valueIsTable(metatableValue)) metatable = asTable(metatableValue);
		else if (!isNil(metatableValue)) return false;
		asTable(target)->metatable = metatable;
		result = target;
		return true;
	}
	case BuiltinFunctionId::GetMetatable: {
		const Value target = args[0];
		if (!valueIsTable(target)) return false;
		Table* metatable = asTable(target)->metatable;
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
				if (!valueIsNumber(positionValue)) return false;
				position = toI32(positionValue);
			}
		}
		const StringId sourceId = asStringId(sourceValue);
		result = position < 1 || position > m_stringPool.codepointCount(sourceId) ? valueNil()
			: valueNumber(static_cast<double>(m_stringPool.codepointAt(sourceId, static_cast<size_t>(position - 1))));
		return true;
	}
	default:
		return false;
	}
}

} // namespace bmsx
