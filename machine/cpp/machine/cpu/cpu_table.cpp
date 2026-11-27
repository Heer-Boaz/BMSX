#include "machine/cpu/cpu.h"

#include "machine/cpu/value_length.h"

namespace bmsx {

u32 CPU::tableIndexAddress(Value base) const {
	if (valueIsTable(base)) return valuePayload(base);
	if (valueIsString(base)) {
		if (const u32 index = m_heap.diagnosticWord(HeapServiceRemarkHeadField::StringIndexWord)) return index;
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
	if (valueTag(method) == ValueTag::ResidentFunction) {
		beginResidentCall(valuePayload(method), {args.data(), args.size()}, placement);
	} else if (valueIsBuiltinFunction(method)) {
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(method))], frame, placement, {args.data(), args.size()});
	} else throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

bool CPU::finishTableRead(CallFrame& frame, int destination, Value base, Value key, TableLookupResult& result) {
	u32 carried = 0;
	while (result.status == TableLookupStatus::Forward) {
		carried += result.extraVisits;
		base = result.value;
		const u32 index = valueIsString(base) ? m_heap.diagnosticWord(HeapServiceRemarkHeadField::StringIndexWord) : 0u;
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

bool CPU::beginTableGrowth(u32 receiver, Value key, Value value, u8 extra, HeapServiceTableGrowthMode mode, BiosCallContinuation completion) {
	if (m_runKind == CpuRunKind::Idle) return false;
	const u32 function = m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::TableGrow)];
	if (function == 0u) return false;
	const u32 management = m_heapAllocator.managementOffset();
	const u32 head = management + HEAP_SERVICE_REMARK_HEAD_OFFSET;
	using Field = HeapServiceRemarkHeadField;
	m_memory.writeRamRecordWord(head + static_cast<u32>(Field::Receiver), receiver);
	m_memory.writeRamRecordPair(head + static_cast<u32>(Field::KeyTag), static_cast<u32>(valueTag(key)), valuePayload(key));
	m_memory.writeRamRecordPair(head + static_cast<u32>(Field::ValueTag), static_cast<u32>(valueTag(value)), valuePayload(value));
	const std::array args{management, static_cast<u32>(remainingDeviceCycles()), static_cast<u32>(extra), static_cast<u32>(mode)};
	armBiosCall(completion.kind, completion.target, completion.word);
	beginHeapService(function, args);
	requestYield();
	return true;
}

bool CPU::parkTableWrite(CallFrame& frame, u32 receiver, Value key, Value value, u8 extraHashSlots) {
	const Value canonical = canonicalTableKey(key);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	++m_diagnosticGcProfile.fullCollections;
#endif
	m_pendingAllocation = {
		m_heap.active() ? AllocationRecovery::Current : AllocationRecovery::Fresh,
		m_currentInstructionPc, lastPc, frame.readControl(FrameField::Pc), receiver, extraHashSlots, canonical, value
	};
	frame.writeControl(FrameField::Pc, m_pendingAllocation.instructionPc);
	// The final root head visits parked operands after detaching the
	// changed queue and before clearing weak references.
	return true;
}

bool CPU::advanceAllocationRecovery() {
	switch (m_pendingAllocation.recovery) {
		case AllocationRecovery::RetryCurrent:
		case AllocationRecovery::RetryFresh: return false;
		case AllocationRecovery::Current:
		case AllocationRecovery::Fresh: {
			if (m_heap.finalMarkPending()) m_heap.stepFinalMark();
			else m_heap.step(valueNil(), valueNil(), valueNil());
			finishAllocationRecovery();
			return true;
		}
		case AllocationRecovery::None: BMSX_UNREACHABLE();
	}
	BMSX_UNREACHABLE();
}

void CPU::finishAllocationRecovery() {
	if (!m_heap.active()) {
		auto& recovery = m_pendingAllocation.recovery;
		recovery = recovery == AllocationRecovery::Current ? AllocationRecovery::RetryCurrent : AllocationRecovery::RetryFresh;
	}
}

void CPU::resumeAllocation() {
	const auto& pending = m_pendingAllocation;
	auto& frame = *m_activeThread->currentFrame;
	m_currentInstructionPc = pending.instructionPc;
	lastPc = pending.lastPc;
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	const auto stage = pending.recovery == AllocationRecovery::RetryFresh
		? HeapServiceTableGrowthStage::RetryFresh : HeapServiceTableGrowthStage::RetryCurrent;
	const bool retired = TableRecord(m_heap, pending.receiver).resumeAssignment(
		pending.key, pending.value, pending.extraHashSlots, this, stage);
	if (heapServiceActive()) {
		m_pendingAllocation = {};
		return;
	}
	if (retired) {
		frame.writeControl(FrameField::Pc, pending.nextPc);
		m_pendingAllocation = {};
		return;
	}
	if (pending.recovery == AllocationRecovery::RetryCurrent) {
		m_pendingAllocation.recovery = AllocationRecovery::Fresh;
		return;
	}

	m_pendingAllocation = {};
	retireNumericLuaFault(LUA_FAULT_REASON_OUT_OF_MEMORY);
}

void CPU::advanceTableStore(CallFrame& frame) {
	const u32 receiver = tableRebuild.record;
	TableRecord table(m_heap, receiver);
	const auto phase = tableRebuild.census;
	if (phase == TableCensus::None) instructionBudgetRemaining = table.advanceRebuild(tableRebuild, instructionBudgetRemaining);
	else {
		m_currentInstructionPc = tableRebuild.instructionPc;
		if (!table.advanceCensus(*this)) {
			if (phase == TableCensus::RetryFresh) throw LuaOutOfMemorySignal{};
			parkTableWrite(frame, receiver, tableRebuild.key, tableRebuild.value);
			if (phase == TableCensus::RetryCurrent) m_pendingAllocation.recovery = AllocationRecovery::Fresh;
			return;
		}
		if (heapServiceActive()) {
			requestYield();
			return;
		}
	}
	if (tableRebuild.record || tableRebuild.result == TableStoreReturn::None) return;
	// Result placement can grow a frame and collect. Do it only after both
	// the replacement and its new edge have been published.
	m_currentInstructionPc = tableRebuild.instructionPc;
	auto scratch = acquireBuiltinResultScratch();
	auto& out = scratch.get();
	out.push_back(valueTable(receiver));
	writeReturnValues(frame, {static_cast<int>(tableRebuild.destination), tableRebuild.wanted}, BuiltinArgsView(out.data(), 1));
}

bool CPU::storeTableIndex(CallFrame& frame, Value base, Value key, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveAssignment(key, result);
	if (finishTableAssignment(frame, key, value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	const auto slot = m_runKind == CpuRunKind::Scheduled ? table.assignScheduled(key, value, *this) : table.set(key, value, this);
	if (slot == TableRecord::HASH_STORE_DECLINED) return parkTableWrite(frame, result.receiver, key, value);
	return slot == TableRecord::HASH_STORE_PENDING && heapServiceActive();
}

bool CPU::storeTableIntegerIndex(CallFrame& frame, Value base, int index, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveIntegerAssignment(index, result);
	if (finishTableAssignment(frame, valueInteger(index), value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	const Value key = valueInteger(index);
	const auto slot = m_runKind == CpuRunKind::Scheduled ? table.assignScheduled(key, value, *this) : table.set(key, value, this);
	if (slot == TableRecord::HASH_STORE_DECLINED) return parkTableWrite(frame, result.receiver, key, value);
	return slot == TableRecord::HASH_STORE_PENDING && heapServiceActive();
}

bool CPU::storeTableFieldIndexCached(CallFrame& frame, int& predictedSlot, Value base, StringId key, Value value, u8 extraHashSlots) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveStringAssignment(key, result);
	if (finishTableAssignment(frame, valueString(key), value, result)) return true;
	if (result.extraVisits != 0u) extraHashSlots = 0;
	TableRecord table(m_heap, result.receiver);
	const int slot = m_runKind == CpuRunKind::Scheduled
		? table.assignScheduled(valueString(key), value, *this, result.slot, extraHashSlots)
		: table.setStringKey(key, value, result.slot, extraHashSlots, this);
	if (slot == TableRecord::HASH_STORE_DECLINED)
		return parkTableWrite(frame, result.receiver, valueString(key), value, extraHashSlots);
	if (slot == TableRecord::HASH_STORE_PENDING && heapServiceActive()) return true;
	if (result.extraVisits == 0) predictedSlot = slot;
	return false;
}

bool CPU::executeLength(CallFrame& frame, int destination, Value operand) {
	if (valueIsTable(operand)) {
		const Value method = TableRecord(m_heap, valuePayload(operand)).metatableField(HeapServiceRemarkHeadField::Length);
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
