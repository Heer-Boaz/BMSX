// The linked allocate_record body owns admission, assistance and retry.
void CPU::beginClosureReservation(CallFrame& frame, int destination, u32 prototype, u32 domain, u32 nextPc) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_CLOSURE_OFFSET;
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::Destination), static_cast<u32>(destination + 1), prototype);
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::InstructionPc), m_currentInstructionPc, lastPc);
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::NextPc), nextPc);
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	const std::array args{management, static_cast<u32>(HeapServiceRecordKind::CanonicalClosure), prototype, domain,
		static_cast<u32>(HeapServiceRecordMode::Direct), static_cast<u32>(std::max(0, instructionBudgetRemaining))};
	beginHeapService(m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::AllocateRecord)], args);
}

void CPU::finishClosureReservation() {
	const u32 base = m_heapAllocator.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET;
	const u32 markedDestination = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::Destination));
	if (markedDestination == 0u) return;
	m_currentInstructionPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::Destination), 0u);
	const u32 offset = heapServiceResult();
	if (offset == 0u) throw LuaOutOfMemorySignal{};
	const u32 address = RAM_BASE + offset;
	const int destination = static_cast<int>(markedDestination - 1u);
	const u32 prototype = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::Prototype));
	m_staticClosuresByAddress.insert(prototype, address);
	CallFrame& frame = *m_activeThread->currentFrame;
	frame.registers.set(destination, valueClosure(address));
	frame.extendTop(destination + 1);
	frame.writeControl(FrameField::Pc, m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::NextPc)));
}
