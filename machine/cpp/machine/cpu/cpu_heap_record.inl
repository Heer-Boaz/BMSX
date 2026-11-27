// The linked allocate_record body owns admission, assistance and retry.
void CPU::beginClosureReservation(CallFrame& frame, int destination, u32 prototype, u32 domain, u32 nextPc) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_CLOSURE_OFFSET;
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::Destination), static_cast<u32>(destination + 1), m_currentInstructionPc);
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::LastPc), lastPc, nextPc);
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	const std::array args{management, static_cast<u32>(HeapServiceRecordKind::CanonicalClosure), prototype, domain,
		static_cast<u32>(HeapServiceRecordMode::Direct), static_cast<u32>(remainingDeviceCycles())};
	beginHeapService(m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::AllocateRecord)], args);
}

void CPU::beginCanonicalLatchedClosure(CallFrame& frame, int destination) {
	using Field = HeapServiceCaptureBindingField;
	const auto& record = m_functionRecordLatch;
	const u32 management = m_heapAllocator.managementOffset(), base = management + HEAP_SERVICE_CLOSURE_OFFSET;
	const u32 binding = management + HEAP_SERVICE_CAPTURE_BINDING_OFFSET;
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::Destination), static_cast<u32>(destination + 1), m_currentInstructionPc);
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::LastPc), lastPc, frame.readControl(FrameField::Pc));
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Prototype), record.address, static_cast<u32>(record.image->executionDomainId));
	const u32 flags = CLOSURE_CANONICAL | CLOSURE_LATCHED_PROTOTYPE;
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::BindingFlags), flags, record.codeAddress);
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Params), record.numParams, record.maxStack);
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Flags), record.flags, record.upvalueTableAddress);
	m_memory.writeRamRecordWord(binding + static_cast<u32>(Field::Count), record.upvalueCount);
	const std::array args{management, RAM_BASE + frame.controlOffset, frame.thread->address,
		RAM_BASE + binding, 0u, static_cast<u32>(remainingDeviceCycles())};
	beginHeapService(m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::CapturedClosure)], args);
}

void CPU::finishClosureReservation() {
	const u32 base = m_heapAllocator.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET;
	const u32 markedDestination = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::Destination));
	if (markedDestination == 0u) return;
	m_currentInstructionPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	m_memory.writeRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::Destination), 0u);
	CallFrame& frame = *m_activeThread->currentFrame;
	const u32 offset = heapServiceResult();
	if (offset == 0u) throw LuaOutOfMemorySignal{};
	const u32 address = RAM_BASE + offset;
	const int destination = static_cast<int>(markedDestination - 1u);
	m_staticClosuresByAddress.insert(m_memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), address);
	frame.registers.set(destination, valueClosure(address));
	frame.extendTop(destination + 1);
	frame.writeControl(FrameField::Pc, m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::NextPc)));
}
