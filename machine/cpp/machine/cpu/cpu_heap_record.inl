// Only canonical ROM Closure cache misses use this direct continuation.
void CPU::beginRecordReservation(CallFrame& frame, int destination, u32 prototype, u32 domain, u32 nextPc) {
	const u32 charged = closureRecordBytes(0u);
	const i32 debt = m_luaHeap.allocationDebt(charged);
	if (debt < 0 && charged > m_luaHeap.capacity()) throw LuaOutOfMemorySignal{};
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_RECORD_OFFSET;
	const u32 assist = management + HEAP_SERVICE_RECORD_CONTROL_OFFSET;
	const u32 stageAddress = base + static_cast<u32>(HeapServiceRecordField::Stage);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Destination), static_cast<u32>(destination));
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceRecordField::Prototype), prototype, domain);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::InstructionPc), m_currentInstructionPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::LastPc), lastPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::NextPc), nextPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::DirectRecovery), static_cast<u32>(LuaAllocationRecovery::CurrentOrFresh));
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	const int budget = std::max(0, instructionBudgetRemaining);
	if (debt < 0) {
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Budget), static_cast<u32>(budget));
		startDirectRecordLogicalEpoch();
	} else if (debt > 0 && budget >= GC_WORK_WORD_CYCLES) {
		const bool pressure = m_luaHeap.logicalAssistPressure(charged);
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Budget), static_cast<u32>(budget));
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::EpochBefore), m_heap.epochWork());
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Debt), static_cast<u32>(debt));
		m_memory.writeRamRecordWord(assist + static_cast<u32>(HeapServiceRecordControlField::Pressure), static_cast<u32>(pressure));
		m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::LogicalAssist));
		stepRecordCollection(std::min(LuaHeap::logicalAssistAllowance(debt, pressure), static_cast<size_t>(budget / GC_WORK_WORD_CYCLES)));
		if (!heapServiceActive()) finishRecordCollection(HeapServiceRecordStage::LogicalAssist);
	} else {
		startRecordPhysicalAssist(budget, prototype, domain);
	}
}

void CPU::startRecordPhysicalAssist(int budget, u32 prototype, u32 domain) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 stageAddress = management + HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage);
	if (budget >= GC_WORK_WORD_CYCLES && GcHeap::pacedPhase(m_heap.phase())) {
		const auto allowance = m_heap.reservationAssistAllowance(GC_OBJECT_PREFIX + closureRecordBytes(0u));
		if (allowance) {
			m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::PhysicalAssist));
			stepRecordCollection(std::min(*allowance, static_cast<size_t>(budget / GC_WORK_WORD_CYCLES)));
			if (heapServiceActive()) return;
		}
	}
	startRecordReservation(prototype, domain);
}

void CPU::startRecordReservation(u32 prototype, u32 domain) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 arena = m_heapAllocator.stateOffset();
	const u32 control = management + HEAP_GC_CONTROL_OFFSET;
	const u32 occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const auto& services = m_systemImage->heapServiceFunctions;
	m_memory.writeRamRecordWord(management + HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage),
		static_cast<u32>(HeapServiceRecordStage::Direct));
	const std::array arguments{arena, control, occupied, prototype, domain};
	beginHeapService(services[static_cast<size_t>(HeapServiceOperation::CreateClosure)], arguments);
}

void CPU::finishRecordReservation() {
	const u32 base = m_heapAllocator.managementOffset() + HEAP_SERVICE_RECORD_OFFSET;
	const u32 stageAddress = base + static_cast<u32>(HeapServiceRecordField::Stage);
	if (m_memory.readRamRecordWord(stageAddress) == static_cast<u32>(HeapServiceRecordStage::Idle)) return;
	const int destination = static_cast<int>(m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Destination)));
	const u32 nextPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::NextPc));
	m_currentInstructionPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	auto& frame = *m_activeThread->currentFrame;
	m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::Idle));
	if (const u32 offset = heapServiceResult()) {
		const u32 address = RAM_BASE + offset;
		const u32 prototype = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Prototype));
		m_staticClosuresByAddress.insert(prototype, address);
		frame.registers.set(destination, valueClosure(address));
		frame.extendTop(destination + 1);
		frame.writeControl(FrameField::Pc, nextPc);
		return;
	}

	// Every partial reservation was released. Publish the original
	// one-epoch recovery policy before the next BIOS instruction.
	const u32 recoveryAddress = base + static_cast<u32>(HeapServiceRecordField::DirectRecovery);
	const auto recovery = m_heap.beginAllocationRecovery(static_cast<LuaAllocationRecovery>(m_memory.readRamRecordWord(recoveryAddress)));
	m_memory.writeRamRecordWord(recoveryAddress, static_cast<u32>(recovery));
	m_memory.writeRamRecordWord(stageAddress, static_cast<u32>(HeapServiceRecordStage::DirectRecovery));
	advanceDirectRecordRecovery();
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
	const u32 prototype = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Prototype));
	const u32 domain = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::ExecutionDomain));
	if (stage == HeapServiceRecordStage::DirectRecovery || stage == HeapServiceRecordStage::PhysicalAssist) {
		startRecordReservation(prototype, domain);
		return;
	}
	const u32 charged = closureRecordBytes(0u);
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
	startRecordPhysicalAssist(budget, prototype, domain);
}
