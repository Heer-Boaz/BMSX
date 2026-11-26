// Mutator record admission runs the source policy once, then parks the
// instruction on its raw operands until the fixed firmware grant retires.
bool CPU::beginRecordReservation(CallFrame& frame, HeapServiceRecordKind kind, int destination, u32 operand0, u32 operand1,
	HeapServiceRecordStage stage, u32 nextPc) {
	const bool retry = stage == HeapServiceRecordStage::RetryCurrent || stage == HeapServiceRecordStage::RetryFresh;
	const bool table = kind == HeapServiceRecordKind::Table;
	const u32 binding = table ? static_cast<u32>(TableRecord::hashCapacity(static_cast<int>(operand1))) : operand1;
	const u32 charged = table ? TableRecord::HEADER_CHARGE + TableRecord::allocationCharge(operand0, binding) : closureRecordBytes(0u);
	const i32 debt = retry ? (m_luaHeap.usedBytes() + charged > m_luaHeap.capacity() ? -1 : 0)
		: m_luaHeap.allocationDebt(charged);
	if (debt < 0) {
		if (retry) return false;
		if (charged > m_luaHeap.capacity()) throw LuaOutOfMemorySignal{};
		if (stage == HeapServiceRecordStage::Scheduled) return false;
	}
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_RECORD_OFFSET;
	const u32 assist = management + HEAP_SERVICE_RECORD_CONTROL_OFFSET;
	const u32 stageAddress = base + static_cast<u32>(HeapServiceRecordField::Stage);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Destination), static_cast<u32>(destination));
	// The Table size words alias the Closure prototype and execution domain.
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceRecordField::ArraySize), operand0, operand1);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::InstructionPc), m_currentInstructionPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::LastPc), lastPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::NextPc), nextPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::DirectRecovery), static_cast<u32>(LuaAllocationRecovery::CurrentOrFresh));
	m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Kind), static_cast<u32>(kind));
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	const int budget = std::max(0, instructionBudgetRemaining);
	if (retry) {
		startRecordReservation(stage, kind, operand0, binding, charged);
	} else if (debt < 0) {
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Budget), static_cast<u32>(budget));
		startDirectRecordLogicalEpoch();
	} else if (debt > 0 && budget >= GC_WORK_WORD_CYCLES) {
		const bool pressure = m_luaHeap.logicalAssistPressure(charged);
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Budget), static_cast<u32>(budget));
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::EpochBefore), m_heap.epochWork());
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Debt), static_cast<u32>(debt));
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Pressure), static_cast<u32>(pressure));
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::ReservationStage), static_cast<u32>(stage));
		m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::LogicalAssist));
		stepRecordCollection(std::min(LuaHeap::logicalAssistAllowance(debt, pressure), static_cast<size_t>(budget / GC_WORK_WORD_CYCLES)));
		if (!heapServiceActive()) finishRecordCollection(HeapServiceRecordStage::LogicalAssist);
	} else {
		startRecordPhysicalAssist(stage, kind, budget, operand0, binding, charged);
	}
	return true;
}

void CPU::startRecordPhysicalAssist(HeapServiceRecordStage stage, HeapServiceRecordKind kind, int budget, u32 operand0, u32 operand1, u32 charged) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 stageAddress = management + HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage);
	if (budget >= GC_WORK_WORD_CYCLES && GcHeap::pacedPhase(m_heap.phase())) {
		const u32 physical = kind == HeapServiceRecordKind::Table
			? TableRecord::HEADER_BYTES + GC_OBJECT_PREFIX + 5u * operand0 + TableRecord::hashStorageBytes(operand1)
			: GC_OBJECT_PREFIX + closureRecordBytes(0u);
		const auto allowance = m_heap.reservationAssistAllowance(physical);
		if (allowance) {
			const u32 assist = management + HEAP_SERVICE_RECORD_CONTROL_OFFSET;
			m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::ReservationStage), static_cast<u32>(stage));
			m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::PhysicalAssist));
			stepRecordCollection(std::min(*allowance, static_cast<size_t>(budget / GC_WORK_WORD_CYCLES)));
			if (heapServiceActive()) return;
		}
	}
	startRecordReservation(stage, kind, operand0, operand1, charged);
}

void CPU::startRecordReservation(HeapServiceRecordStage stage, HeapServiceRecordKind kind, u32 operand0, u32 operand1, u32 charged) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 arena = m_heapAllocator.stateOffset();
	const u32 control = management + HEAP_GC_CONTROL_OFFSET;
	const u32 occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const auto& services = m_systemImage->heapServiceFunctions;
	m_memory.writeRamRecordWord(management + HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage),
		static_cast<u32>(stage));
	if (kind == HeapServiceRecordKind::Table) {
		const std::array arguments{
			arena, control, occupied, operand0, operand1, 5u * operand0,
			static_cast<u32>(TableRecord::hashStorageBytes(operand1)), charged,
		};
		beginHeapService(services[static_cast<size_t>(HeapServiceOperation::CreateTable)], arguments);
	} else {
		const std::array arguments{arena, control, occupied, operand0, operand1};
		beginHeapService(services[static_cast<size_t>(HeapServiceOperation::CreateClosure)], arguments);
	}
}

void CPU::finishRecordReservation() {
	const u32 base = m_heapAllocator.managementOffset() + HEAP_SERVICE_RECORD_OFFSET;
	const u32 stageAddress = base + static_cast<u32>(HeapServiceRecordField::Stage);
	const auto stage = static_cast<HeapServiceRecordStage>(m_memory.readRamRecordWord(stageAddress));
	if (stage == HeapServiceRecordStage::Idle) return;
	const int destination = static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Destination)));
	const u32 nextPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::NextPc));
	m_currentInstructionPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	auto& frame = *m_activeThread->currentFrame;
	m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::Idle));
	if (const u32 offset = heapServiceResult()) {
		const u32 address = RAM_BASE + offset;
		const auto kind = static_cast<HeapServiceRecordKind>(m_memory.readRamRecordWord(
			m_heapAllocator.managementOffset() + HEAP_SERVICE_RECORD_CONTROL_OFFSET + static_cast<u32>(HeapServiceRecordControlField::Kind)));
		if (kind == HeapServiceRecordKind::Table) {
			trackLocalRoot(valueTable(address));
			retireNewTable(frame, destination, address);
		} else {
			const u32 prototype = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Prototype));
			m_staticClosuresByAddress.insert(prototype, address);
			frame.registers.set(destination, valueClosure(address));
			frame.extendTop(destination + 1);
		}
		frame.writeControl(FrameField::Pc, nextPc);
		return;
	}
	if (stage == HeapServiceRecordStage::Direct) {
		// Every partial reservation was released. Publish the original
		// one-epoch recovery policy before the next BIOS instruction.
		const u32 recoveryAddress = base + static_cast<u32>(HeapServiceRecordField::DirectRecovery);
		const auto recovery = m_heap.beginAllocationRecovery(static_cast<LuaAllocationRecovery>(m_memory.readRamRecordWord(recoveryAddress)));
		m_memory.writeRamRecordWord(recoveryAddress, static_cast<u32>(recovery));
		m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::DirectRecovery));
		advanceDirectRecordRecovery();
		return;
	}
	const PendingTableCreation create{
		destination,
		static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::ArraySize))),
		static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::HashSize))),
	};
	switch (stage) {
		case HeapServiceRecordStage::Scheduled:
			frame.writeControl(FrameField::Pc, nextPc);
			parkAllocation(frame, create);
			return;
		case HeapServiceRecordStage::RetryCurrent:
			m_pendingAllocation = {AllocationRecovery::Fresh, m_currentInstructionPc, lastPc, nextPc, create};
			return;
		case HeapServiceRecordStage::RetryFresh:
			throw LuaOutOfMemorySignal{};
		case HeapServiceRecordStage::Idle:
		case HeapServiceRecordStage::Direct:
		case HeapServiceRecordStage::DirectRecovery:
		case HeapServiceRecordStage::LogicalAssist:
		case HeapServiceRecordStage::PhysicalAssist:
		case HeapServiceRecordStage::DirectLogicalRecovery:
			BMSX_UNREACHABLE();
	}
	BMSX_UNREACHABLE();
}

void CPU::stepRecordCollection(size_t words) {
	const auto& services = m_systemImage->heapServiceFunctions;
	const size_t work = m_heap.finalMarkPending()
		? m_heap.stepFinalMark(words, HeapServiceGcStage::MaintenanceTrace, &services)
		: m_heap.step(valueNil(), valueNil(), valueNil(), 0u, false, words, HeapServiceGcStage::AllocationRecoveryStringSweep, &services);
	chargeCollectionWork(work);
}

void CPU::startDirectRecordLogicalEpoch() {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_RECORD_OFFSET;
	const u32 assist = management + HEAP_SERVICE_RECORD_CONTROL_OFFSET;
	const u32 recoveryAddress = base + static_cast<u32>(HeapServiceRecordField::DirectRecovery);
	const auto recovery = static_cast<LuaAllocationRecovery>(m_memory.readRamRecordWord(recoveryAddress));
	if (recovery == LuaAllocationRecovery::Exhausted) {
		m_currentInstructionPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::InstructionPc));
		lastPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::LastPc));
		m_lastExecutionDomainId = m_activeExecutionDomainId;
		m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Stage), static_cast<u32>(HeapServiceRecordStage::Idle));
	}
	const auto afterEpoch = m_heap.beginAllocationRecovery(recovery);
	m_memory.writeRamRecordWord(recoveryAddress, static_cast<u32>(afterEpoch));
	m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::EpochBefore), m_heap.epochWork());
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Stage), static_cast<u32>(HeapServiceRecordStage::DirectLogicalRecovery));
	advanceDirectRecordRecovery();
}

void CPU::advanceDirectRecordRecovery() {
	do {
		stepRecordCollection(GC_STEP_WORDS);
		// A quantum may spend its entire allowance draining native work
		// already done before this request. It did not admit firmware.
	} while (!heapServiceActive() && m_heap.active());
}

void CPU::finishRecordCollection(HeapServiceRecordStage stage) {
	const bool directEpoch = stage == HeapServiceRecordStage::DirectRecovery || stage == HeapServiceRecordStage::DirectLogicalRecovery;
	if (directEpoch && m_heap.active()) {
		advanceDirectRecordRecovery();
		return;
	}
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_RECORD_OFFSET;
	const u32 assist = management + HEAP_SERVICE_RECORD_CONTROL_OFFSET;
	const auto kind = static_cast<HeapServiceRecordKind>(m_memory.readRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Kind)));
	const bool table = kind == HeapServiceRecordKind::Table;
	const u32 operand0 = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::ArraySize));
	const u32 operand1 = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::HashSize));
	const u32 binding = table ? static_cast<u32>(TableRecord::hashCapacity(static_cast<int>(operand1))) : operand1;
	const u32 charged = table ? TableRecord::HEADER_CHARGE + TableRecord::allocationCharge(operand0, binding) : closureRecordBytes(0u);
	const auto reservationStage = directEpoch ? HeapServiceRecordStage::Direct
		: static_cast<HeapServiceRecordStage>(m_memory.readRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::ReservationStage)));
	if (stage == HeapServiceRecordStage::DirectRecovery || stage == HeapServiceRecordStage::PhysicalAssist) {
		startRecordReservation(reservationStage, kind, operand0, binding, charged);
		return;
	}
	const u32 work = m_heap.workSinceEpoch(m_memory.readRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::EpochBefore)));
	// Carry the source grant forward for the policy, not CPU accounting.
	const i64 remaining = static_cast<i64>(m_memory.readRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Budget)))
		- GC_WORK_WORD_CYCLES * static_cast<i64>(work);
	const int budget = static_cast<int>(std::max<i64>(0, remaining));
	if (stage == HeapServiceRecordStage::LogicalAssist) {
		m_luaHeap.creditLogicalAssist(charged, m_memory.readRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Debt)),
			m_memory.readRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Pressure)) != 0u, work);
	} else if (m_luaHeap.usedBytes() + charged > m_luaHeap.capacity()) {
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Budget), static_cast<u32>(budget));
		startDirectRecordLogicalEpoch();
		return;
	}
	startRecordPhysicalAssist(reservationStage, kind, budget, operand0, binding, charged);
}
