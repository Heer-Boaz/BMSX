#include "machine/cpu/cpu.h"

#include "machine/cpu/value_length.h"

namespace bmsx {

u32 CPU::tableIndexAddress(Value base) const {
	if (valueIsTable(base)) return valuePayload(base);
	if (valueIsString(base) && !isNil(m_stringIndexTable)) return valuePayload(m_stringIndexTable);
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

void CPU::invokeImplicit(CallFrame& frame, CallResultPlacement placement, Value method, std::span<const Value> args) {
	auto roots = acquireLocalRoots();
	trackLocalRoot(method);
	for (const Value arg : args) trackLocalRoot(arg);
	if (valueIsClosure(method)) {
		const u32 closure = asClosure(method, m_heap);
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		pushFrame(closure, BuiltinArgsView(args.data(), args.size()), placement, 0u, m_currentInstructionPc);
	} else if (valueIsBuiltinFunction(method)) {
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(method))], frame, placement,
			{nullptr, args.data(), 0, static_cast<int>(args.size())});
	} else throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

bool CPU::finishTableRead(CallFrame& frame, int destination, Value base, Value key, TableLookupResult& result) {
	u32 carried = 0;
	while (result.status == TableLookupStatus::Forward) {
		carried += result.extraVisits;
		base = result.value;
		if (!valueIsString(base) || isNil(m_stringIndexTable)) {
			instructionBudgetRemaining -= static_cast<int>(carried) * TABLE_INDEX_VISIT_CYCLES;
			throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		// A forwarded String uses its live installed index Table, but retains
		// its own Value as the receiver for a callable at this first visit.
		if (++carried == TABLE_INDEX_CHAIN_LIMIT) {
			instructionBudgetRemaining -= (TABLE_INDEX_CHAIN_LIMIT - 1) * TABLE_INDEX_VISIT_CYCLES;
			throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		}
		TableRecord(m_heap, valuePayload(m_stringIndexTable)).resolveIndex(asStringId(m_indexKey), key,
			result, TABLE_INDEX_CHAIN_LIMIT - carried);
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
	TableRecord(m_heap, tableIndexAddress(base)).resolveIndex(asStringId(m_indexKey), key, result);
	return finishTableRead(frame, destination, base, key, result);
}

bool CPU::loadTableIntegerIndex(CallFrame& frame, int destination, Value base, int index) {
	TableLookupResult result;
	TableRecord(m_heap, tableIndexAddress(base)).resolveIntegerIndex(asStringId(m_indexKey), index, result);
	return finishTableRead(frame, destination, base, valueInteger(index), result);
}

void CPU::resolveTableFieldIndexCached(int& predictedSlot, Value base, StringId key, TableLookupResult& result) {
	TableRecord(m_heap, tableIndexAddress(base)).resolveStringIndexCached(asStringId(m_indexKey), key, predictedSlot, result);
	if (result.extraVisits == 0 && result.slot >= 0) predictedSlot = result.slot;
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

void CPU::markPendingTableWriteRoots(GcHeap& heap) {
	const auto& write = m_pendingTableWrite;
	heap.markValue(valueTable(write.receiver));
	heap.markValue(write.key);
	heap.markValue(write.value);
}

bool CPU::parkTableWrite(CallFrame& frame, u32 receiver, Value key, Value value) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	++m_diagnosticGcProfile.fullCollections;
#endif
	m_pendingTableWrite = {
		m_heap.active() ? TableWriteRecovery::Current : TableWriteRecovery::Fresh,
		m_currentInstructionPc, lastPc, frame.readControl(FrameField::Pc), receiver,
		canonicalTableKey(key), value
	};
	frame.writeControl(FrameField::Pc, m_pendingTableWrite.instructionPc);
	// The final root head visits parked operands after detaching the
	// changed queue and before clearing weak references.
	return true;
}

bool CPU::advanceTableWriteRecovery() {
	auto& write = m_pendingTableWrite;
	switch (write.recovery) {
		case TableWriteRecovery::RetryCurrent:
		case TableWriteRecovery::RetryFresh: return false;
		case TableWriteRecovery::Current:
		case TableWriteRecovery::Fresh:
			if (m_heap.finalMarkPending()) m_heap.stepFinalMark();
			else m_heap.step(valueNil(), valueNil(), valueNil());
			if (!m_heap.active()) write.recovery = write.recovery == TableWriteRecovery::Current
				? TableWriteRecovery::RetryCurrent : TableWriteRecovery::RetryFresh;
			return true;
		case TableWriteRecovery::None: BMSX_UNREACHABLE();
	}
	BMSX_UNREACHABLE();
}

void CPU::resumeTableWrite() {
	const auto write = m_pendingTableWrite;
	m_currentInstructionPc = write.instructionPc;
	lastPc = write.lastPc;
	if (TableRecord(m_heap, write.receiver).resumeAssignment(write.key, write.value)) {
		m_activeThread->currentFrame->writeControl(FrameField::Pc, write.nextPc);
		m_pendingTableWrite = {};
		return;
	}
	if (write.recovery == TableWriteRecovery::RetryCurrent) {
		m_pendingTableWrite.recovery = TableWriteRecovery::Fresh;
		return;
	}

	m_pendingTableWrite = {};
	const Value error = m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY];
	if (!handleThreadError(error)) enterLuaFaultException(LUA_FAULT_REASON_OUT_OF_MEMORY, error);
}

bool CPU::storeTableIndex(CallFrame& frame, Value base, Value key, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveAssignment(asStringId(m_newIndexKey), key, result);
	if (finishTableAssignment(frame, key, value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	if (m_runKind != CpuRunKind::Scheduled) table.set(key, value);
	else if (table.assignScheduled(key, value) == TableRecord::HASH_STORE_DECLINED)
		return parkTableWrite(frame, result.receiver, key, value);
	return false;
}

bool CPU::storeTableIntegerIndex(CallFrame& frame, Value base, int index, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveIntegerAssignment(asStringId(m_newIndexKey), index, result);
	if (finishTableAssignment(frame, valueInteger(index), value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	if (m_runKind != CpuRunKind::Scheduled) table.setInteger(index, value);
	else if (table.assignScheduled(valueInteger(index), value) == TableRecord::HASH_STORE_DECLINED)
		return parkTableWrite(frame, result.receiver, valueInteger(index), value);
	return false;
}

bool CPU::storeTableFieldIndexCached(CallFrame& frame, int& predictedSlot, Value base, StringId key, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveStringAssignment(asStringId(m_newIndexKey), key, result);
	if (finishTableAssignment(frame, valueString(key), value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	const int slot = m_runKind == CpuRunKind::Scheduled
		? table.assignScheduled(valueString(key), value, result.slot)
		: table.setStringKey(key, value, result.slot);
	if (slot == TableRecord::HASH_STORE_DECLINED) return parkTableWrite(frame, result.receiver, valueString(key), value);
	if (result.extraVisits == 0) predictedSlot = slot;
	return false;
}

bool CPU::executeLength(CallFrame& frame, int destination, Value operand) {
	if (valueIsTable(operand)) {
		const Value method = TableRecord(m_heap, valuePayload(operand)).metatableField(asStringId(m_lengthKey));
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
