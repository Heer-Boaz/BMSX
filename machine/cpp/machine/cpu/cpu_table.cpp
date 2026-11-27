#include "machine/cpu/cpu.h"

#include "machine/cpu/value_length.h"

namespace bmsx {

u32 CPU::tableIndexAddress(Value base) const {
	if (valueIsTable(base)) return valuePayload(base);
	if (valueIsString(base)) {
		if (const u32 index = m_heap.diagnosticWord(GcDiagnosticField::StringIndexWord)) return index;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

void CPU::invokeImplicit(CallFrame& frame, CallResultPlacement placement, Value method, std::span<const Value> args) {
	if (valueIsClosure(method)) {
		const u32 closure = ClosureRecord::recordAddress(m_memory, valuePayload(method));
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		pushFrame(closure, BuiltinArgsView(args.data(), args.size()), placement, 0u, m_currentInstructionPc, true);
		return;
	}
	if (valueTag(method) == ValueTag::CodeFunction) {
		pushFrame(0u, BuiltinArgsView(args.data(), args.size()), placement, 0u, m_currentInstructionPc, true, valuePayload(method));
		return;
	}
	auto roots = acquireLocalRoots();
	trackLocalRoot(method);
	for (const Value arg : args) trackLocalRoot(arg);
	if (valueIsBuiltinFunction(method)) {
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(method))], frame, placement, {args.data(), args.size()});
	} else throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

bool CPU::finishTableRead(CallFrame& frame, int destination, Value base, Value key, TableLookupResult& result) {
	u32 carried = 0;
	while (result.status == TableLookupStatus::Forward) {
		carried += result.extraVisits;
		base = result.value;
		const u32 index = valueIsString(base) ? m_heap.diagnosticWord(GcDiagnosticField::StringIndexWord) : 0u;
		if (index == 0u) {
			instructionBudgetRemaining -= static_cast<int>(carried) * TABLE_INDEX_VISIT_CYCLES;
			throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		// A forwarded String uses its live installed index Table, but retains
		// its own Value as the receiver for a callable at this first visit.
		if (++carried == TABLE_INDEX_CHAIN_LIMIT) {
			instructionBudgetRemaining -= (TABLE_INDEX_CHAIN_LIMIT - 1) * TABLE_INDEX_VISIT_CYCLES;
			throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		}
		instructionBudgetRemaining -= static_cast<int>(TableRecord(m_heap, index).resolveIndex(key,
			result, TABLE_INDEX_CHAIN_LIMIT - carried));
	}
	instructionBudgetRemaining -= static_cast<int>(carried + result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	if (result.status == TableLookupStatus::Invoke) {
		const std::array args{result.extraVisits == 0u ? base : valueTable(result.receiver), key};
		invokeImplicit(frame, CallResultPlacement::single(destination), result.value, args);
		return true;
	}
	frame.registers.set(destination, result.value);
	frame.extendTop(destination + 1);
	return false;
}

bool CPU::loadTableIndex(CallFrame& frame, int destination, Value base, Value key) {
	TableLookupResult result;
	instructionBudgetRemaining -= static_cast<int>(TableRecord(m_heap, tableIndexAddress(base)).resolveIndex(key, result));
	return finishTableRead(frame, destination, base, key, result);
}

bool CPU::loadTableIntegerIndex(CallFrame& frame, int destination, Value base, int index) {
	TableLookupResult result;
	instructionBudgetRemaining -= static_cast<int>(TableRecord(m_heap, tableIndexAddress(base)).resolveIntegerIndex(index, result));
	return finishTableRead(frame, destination, base, valueInteger(index), result);
}

bool CPU::finishTableAssignment(CallFrame& frame, Value key, Value value, const TableLookupResult& result) {
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	switch (result.status) {
	case TableLookupStatus::Store: return false;
	case TableLookupStatus::ChainExhausted: throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	case TableLookupStatus::Forward: throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	case TableLookupStatus::Invoke: {
		const std::array args{valueTable(result.receiver), key, value};
		invokeImplicit(frame, CallResultPlacement::discard(), result.value, args);
		return true;
	}
	case TableLookupStatus::Resolved: BMSX_UNREACHABLE();
	}
	BMSX_UNREACHABLE();
}

bool CPU::enterStorageWindowException(u32 receiver, Value key, Value value, u8 extraHashSlots, int position) {
	const std::array arguments{valueTable(receiver), canonicalTableKey(key), value,
		valueInteger(extraHashSlots), valueInteger(remainingDeviceCycles()), valueInteger(position)};
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_STORAGE_WINDOW,
		m_currentInstructionPc, arguments);
	return true;
}

bool CPU::storeTableIndex(CallFrame& frame, Value base, Value key, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	u32 receiver = valuePayload(base);
	int position = TABLE_HASH_UNPROBED;
	const TableRecord table(m_heap, receiver);
	if (table.metatableAddress() != 0u) {
		TableLookupResult result;
		table.resolveAssignment(key, result);
		if (finishTableAssignment(frame, key, value, result)) return true;
		receiver = result.receiver;
		position = result.slot;
	}
	if (TableRecord(m_heap, receiver).tryAssignOwn(key, value, position))
		return false;
	return enterStorageWindowException(receiver, key, value, 0u, position);
}

bool CPU::storeTableIntegerIndex(CallFrame& frame, Value base, int index, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	u32 receiver = valuePayload(base);
	const Value key = valueInteger(index);
	int position = TABLE_HASH_UNPROBED;
	const TableRecord table(m_heap, receiver);
	if (table.metatableAddress() != 0u) {
		TableLookupResult result;
		table.resolveIntegerAssignment(index, result);
		if (finishTableAssignment(frame, key, value, result)) return true;
		receiver = result.receiver;
		position = result.slot;
	}
	if (TableRecord(m_heap, receiver).tryAssignOwn(key, value, position))
		return false;
	return enterStorageWindowException(receiver, key, value, 0u, position);
}

bool CPU::storeTableFieldIndexCached(CallFrame& frame, int& predictedSlot, Value base, StringId key, Value value, u8 extraHashSlots) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveStringAssignment(key, result, predictedSlot);
	if (finishTableAssignment(frame, valueString(key), value, result)) return true;
	if (result.extraVisits != 0u) extraHashSlots = 0;
	const Value field = valueString(key);
	const bool stored = TableRecord(m_heap, result.receiver).tryAssignOwn(field, value, result.slot);
	if (result.extraVisits == 0 && (stored || result.slot >= 0)) predictedSlot = result.slot;
	return !stored && enterStorageWindowException(result.receiver, field, value, extraHashSlots, result.slot);
}

bool CPU::executeLength(CallFrame& frame, int destination, Value operand) {
	if (valueIsTable(operand)) {
		const Value method = TableRecord(m_heap, valuePayload(operand)).metatableField(GcDiagnosticField::Length);
		if (!isNil(method)) {
			const std::array args{operand, operand};
			invokeImplicit(frame, CallResultPlacement::single(destination), method, args);
			return true;
		}
	}
	const auto length = measureValueLength(operand, m_stringPool, &m_heap);
	if (!length) throw LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
	frame.registers.set(destination, valueInteger(*length));
	frame.extendTop(destination + 1);
	return false;
}

} // namespace bmsx
