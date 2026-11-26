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
		instructionBudgetRemaining -= static_cast<int>(TableRecord(m_heap, valuePayload(m_stringIndexTable)).resolveIndex(key,
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

u32 CPU::allocateTable(int arraySize, int hashSize, LuaAllocationMode mode) {
	const size_t hashCapacity = TableRecord::hashCapacity(hashSize);
	const u32 address = m_luaHeap.allocateRecord(TableRecord::HEADER_BYTES, true, 5u * arraySize,
		static_cast<u32>(TableHeader::ArrayStorage), valueNil(), valueNil(), valueNil(), TableRecord::HEADER_CHARGE + TableRecord::allocationCharge(arraySize, hashCapacity), mode,
		TableRecord::hashStorageBytes(hashCapacity), static_cast<u32>(TableHeader::HashStorage));
	if (!address) return 0u;
	publishNewTable(address, arraySize, hashCapacity);
	return address;
}

void CPU::publishNewTable(u32 address, int arraySize, size_t hashCapacity) {
	TableRecord(m_heap, address).initialize(arraySize, hashCapacity);
	m_heap.publishObject(address);
	trackLocalRoot(valueTable(address));
}

void CPU::retireNewTable(CallFrame& frame, int destination, u32 address) {
	frame.registers.set(destination, valueTable(address));
	frame.extendTop(destination + 1);
}

u32 CPU::reserveNewTable(CallFrame& frame, int destination, int arraySize, int hashSize) {
	const auto mode = m_runKind == CpuRunKind::Scheduled ? LuaAllocationMode::Scheduled : LuaAllocationMode::Direct;
	if (m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::ReserveRecord)] != 0u) {
		const PendingTableCreation create{destination, arraySize, hashSize};
		const auto stage = mode == LuaAllocationMode::Scheduled ? HeapServiceNewtStage::Scheduled : HeapServiceNewtStage::Direct;
		if (beginNewTableReservation(frame, create, stage, frame.readControl(FrameField::Pc))) requestYield();
		else parkAllocation(frame, create);
		return 0u;
	}
	const u32 address = allocateTable(arraySize, hashSize, mode);
	if (!address) parkAllocation(frame, PendingTableCreation{destination, arraySize, hashSize});
	return address;
}

bool CPU::beginNewTableReservation(CallFrame& frame, PendingTableCreation create, HeapServiceNewtStage stage, u32 nextPc) {
	const auto mode = stage == HeapServiceNewtStage::Direct ? LuaAllocationMode::Direct
		: stage == HeapServiceNewtStage::Scheduled ? LuaAllocationMode::Scheduled : LuaAllocationMode::Retry;
	const size_t hashCapacity = TableRecord::hashCapacity(create.hashSize);
	const u32 charged = TableRecord::HEADER_CHARGE + TableRecord::allocationCharge(create.arraySize, hashCapacity);
	const u32 arrayBytes = 5u * create.arraySize;
	const u32 hashBytes = TableRecord::hashStorageBytes(hashCapacity);
	const u32 physical = TableRecord::HEADER_BYTES + GC_OBJECT_PREFIX + arrayBytes + hashBytes;
	const auto recovery = m_luaHeap.admitRecordAllocation(charged, physical, mode);
	if (!recovery) return false;
	const u32 base = m_heapAllocator.managementOffset() + HEAP_SERVICE_NEWT_OFFSET;
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::Destination), static_cast<u32>(create.destination));
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::ArraySize), static_cast<u32>(create.arraySize));
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::HashSize), static_cast<u32>(create.hashSize));
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::InstructionPc), m_currentInstructionPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::LastPc), lastPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::NextPc), nextPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::DirectRecovery), static_cast<u32>(*recovery));
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::Stage), static_cast<u32>(stage));
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	startNewTableReservation(arrayBytes, hashBytes, charged);
	return true;
}

void CPU::startNewTableReservation(u32 arrayBytes, u32 hashBytes, u32 charged) {
	const std::array arguments{
		m_heapAllocator.stateOffset(), TableRecord::HEADER_BYTES, 1u, arrayBytes,
		static_cast<u32>(TableHeader::ArrayStorage), charged,
		hashBytes, static_cast<u32>(TableHeader::HashStorage),
		m_heapAllocator.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET,
	};
	beginHeapService(m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::ReserveRecord)], arguments);
}

void CPU::finishNewTableReservation() {
	const u32 base = m_heapAllocator.managementOffset() + HEAP_SERVICE_NEWT_OFFSET;
	const u32 stageAddress = base + static_cast<u32>(HeapServiceNewtField::Stage);
	const auto stage = static_cast<HeapServiceNewtStage>(m_memory.readRamRecordWord(stageAddress));
	if (stage == HeapServiceNewtStage::Idle) return;
	const PendingTableCreation create{
		static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::Destination))),
		static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::ArraySize))),
		static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::HashSize))),
	};
	const u32 nextPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::NextPc));
	m_currentInstructionPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceNewtField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	auto& frame = *m_activeThread->currentFrame;
	m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceNewtStage::Idle));
	if (const u32 offset = heapServiceResult()) {
		const u32 address = RAM_BASE + offset;
		publishNewTable(address, create.arraySize, TableRecord::hashCapacity(create.hashSize));
		retireNewTable(frame, create.destination, address);
		frame.writeControl(FrameField::Pc, nextPc);
		return;
	}
	switch (stage) {
		case HeapServiceNewtStage::Direct: {
			// The firmware has released every partial reservation. Only now
			// may native collection run, following the original direct retry.
			const u32 recoveryAddress = base + static_cast<u32>(HeapServiceNewtField::DirectRecovery);
			const auto recovery = m_heap.recoverAllocation(static_cast<LuaAllocationRecovery>(m_memory.readRamRecordWord(recoveryAddress)));
			m_memory.writeRamRecordWord(recoveryAddress, static_cast<u32>(recovery));
			m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceNewtStage::Direct));
			const size_t hashCapacity = TableRecord::hashCapacity(create.hashSize);
			startNewTableReservation(5u * create.arraySize, TableRecord::hashStorageBytes(hashCapacity),
				TableRecord::HEADER_CHARGE + TableRecord::allocationCharge(create.arraySize, hashCapacity));
			return;
		}
		case HeapServiceNewtStage::Scheduled:
			frame.writeControl(FrameField::Pc, nextPc);
			parkAllocation(frame, create);
			return;
		case HeapServiceNewtStage::RetryCurrent:
			m_pendingAllocation = {AllocationRecovery::Fresh, m_currentInstructionPc, lastPc, nextPc, create};
			return;
		case HeapServiceNewtStage::RetryFresh:
			throw LuaOutOfMemorySignal{};
		case HeapServiceNewtStage::Idle:
			BMSX_UNREACHABLE();
	}
	BMSX_UNREACHABLE();
}

void CPU::markPendingAllocationRoots(GcHeap& heap) {
	const auto* assignment = std::get_if<PendingTableAssignment>(&m_pendingAllocation.operands);
	if (!assignment) return;
	heap.markValue(valueTable(assignment->receiver));
	heap.markValue(assignment->key);
	heap.markValue(assignment->value);
}

bool CPU::parkTableWrite(CallFrame& frame, u32 receiver, Value key, Value value, u8 extraHashSlots) {
	parkAllocation(frame, PendingTableAssignment{receiver, extraHashSlots, canonicalTableKey(key), value});
	return true;
}

void CPU::parkAllocation(CallFrame& frame, PendingAllocation::Operands operands) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	++m_diagnosticGcProfile.fullCollections;
#endif
	m_pendingAllocation = {
		m_heap.active() ? AllocationRecovery::Current : AllocationRecovery::Fresh,
		m_currentInstructionPc, lastPc, frame.readControl(FrameField::Pc), operands
	};
	frame.writeControl(FrameField::Pc, m_pendingAllocation.instructionPc);
	// The final root head visits parked operands after detaching the
	// changed queue and before clearing weak references.
}

bool CPU::advanceAllocationRecovery() {
	switch (m_pendingAllocation.recovery) {
		case AllocationRecovery::RetryCurrent:
		case AllocationRecovery::RetryFresh: return false;
		case AllocationRecovery::Current:
		case AllocationRecovery::Fresh:
			// This native prefix still belongs to stopped maintenance. Only the
			// String service draws a timed grant, with the quantum's remainder.
			if (m_heap.finalMarkPending()) m_heap.stepFinalMark();
			else m_heap.step(valueNil(), valueNil(), valueNil(), 0u, false, GC_STEP_WORDS,
				m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::StringSweep)],
				HeapServiceGcStage::AllocationRecoveryStringSweep);
			finishAllocationRecovery();
			return true;
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
	bool retired;
	if (const auto* assignment = std::get_if<PendingTableAssignment>(&pending.operands)) {
		retired = TableRecord(m_heap, assignment->receiver).resumeAssignment(
			assignment->key, assignment->value, assignment->extraHashSlots, this);
		if (tableRebuild.census == TableCensus::RetryCurrent && pending.recovery == AllocationRecovery::RetryFresh)
			tableRebuild.census = TableCensus::RetryFresh;
	} else {
		const auto& create = std::get<PendingTableCreation>(pending.operands);
		u32 address = 0u;
		if (m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::ReserveRecord)] != 0u) {
			const auto stage = pending.recovery == AllocationRecovery::RetryCurrent
				? HeapServiceNewtStage::RetryCurrent : HeapServiceNewtStage::RetryFresh;
			if (beginNewTableReservation(frame, create, stage, pending.nextPc)) {
				m_pendingAllocation = {};
				return;
			}
		} else address = allocateTable(create.arraySize, create.hashSize, LuaAllocationMode::Retry);
		retired = address != 0u;
		if (retired) retireNewTable(frame, create.destination, address);
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
	const Value error = m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY];
	if (!handleThreadError(error)) enterLuaFaultException(LUA_FAULT_REASON_OUT_OF_MEMORY, error);
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
	}
	if (tableRebuild.record || tableRebuild.result == TableStoreReturn::None) return;
	// Result placement can grow a frame and collect. Do it only after both
	// the replacement and its new edge have been published.
	m_currentInstructionPc = tableRebuild.instructionPc;
	auto scratch = acquireBuiltinResultScratch();
	auto& out = scratch.get();
	out.push_back(valueTable(receiver));
	if (tableRebuild.result == TableStoreReturn::Protected)
		finishProtectedCall(tableRebuild.destination, {nullptr, out.data(), 0, 1});
	else
		writeReturnValues(frame, {static_cast<int>(tableRebuild.destination), tableRebuild.wanted}, BuiltinArgsView(out.data(), 1));
}

bool CPU::storeTableIndex(CallFrame& frame, Value base, Value key, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveAssignment(key, result);
	if (finishTableAssignment(frame, key, value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	if (m_runKind != CpuRunKind::Scheduled) table.set(key, value, this);
	else if (table.assignScheduled(key, value, *this) == TableRecord::HASH_STORE_DECLINED)
		return parkTableWrite(frame, result.receiver, key, value);
	return false;
}

bool CPU::storeTableIntegerIndex(CallFrame& frame, Value base, int index, Value value) {
	if (!valueIsTable(base)) throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
	TableLookupResult result;
	TableRecord(m_heap, valuePayload(base)).resolveIntegerAssignment(index, result);
	if (finishTableAssignment(frame, valueInteger(index), value, result)) return true;
	TableRecord table(m_heap, result.receiver);
	if (m_runKind != CpuRunKind::Scheduled) table.set(valueInteger(index), value, this);
	else if (table.assignScheduled(valueInteger(index), value, *this) == TableRecord::HASH_STORE_DECLINED)
		return parkTableWrite(frame, result.receiver, valueInteger(index), value);
	return false;
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
	if (result.extraVisits == 0) predictedSlot = slot;
	return false;
}

bool CPU::executeLength(CallFrame& frame, int destination, Value operand) {
	if (valueIsTable(operand)) {
		const Value method = TableRecord(m_heap, valuePayload(operand)).metatableField(m_heap.lengthKey);
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
