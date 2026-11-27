// The linked allocate_record body owns admission, assistance and retry.
void CPU::beginClosureReservation(CallFrame& frame, int destination, HeapServiceRecordKind kind, u32 prototype, u32 domain, u32 nextPc) {
	const u32 management = m_heapAllocator.managementOffset();
	const u32 base = management + HEAP_SERVICE_CLOSURE_OFFSET;
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::Destination), static_cast<u32>(destination + 1), m_currentInstructionPc);
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::LastPc), lastPc, nextPc);
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	const std::array args{management, static_cast<u32>(kind), prototype, domain,
		static_cast<u32>(HeapServiceRecordMode::Direct), static_cast<u32>(remainingDeviceCycles())};
	beginHeapService(m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::AllocateRecord)], args);
}

void CPU::beginCapturedClosure(CallFrame& frame, int destination, u32 descriptorSlot) {
	using Field = HeapServiceCaptureBindingField;
	const auto& record = m_functionRecordLatch;
	const u32 management = m_heapAllocator.managementOffset(), base = management + HEAP_SERVICE_CLOSURE_OFFSET;
	const u32 binding = management + HEAP_SERVICE_CAPTURE_BINDING_OFFSET;
	const u32 workspace = management + HEAP_SERVICE_CAPTURE_WORK_OFFSET;
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::Destination), static_cast<u32>(destination + 1), m_currentInstructionPc);
	m_memory.writeRamRecordPair(base + static_cast<u32>(HeapServiceClosureField::LastPc), lastPc, frame.readControl(FrameField::Pc));
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Prototype), record.address, static_cast<u32>(record.image->executionDomainId));
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Latched), 0u, record.codeAddress);
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Params), record.numParams, record.maxStack);
	m_memory.writeRamRecordPair(binding + static_cast<u32>(Field::Flags), record.flags, record.upvalueTableAddress);
	m_memory.writeRamRecordWord(binding + static_cast<u32>(Field::Count), record.upvalueCount);
	m_memory.writeRamRecordPair(workspace, HEAP_SERVICE_CAPTURE_DESCRIPTOR_PORT, HEAP_SERVICE_CAPTURE_RESOLVED_PORT);
	m_memory.writeRamRecordWord(workspace + 8u, HEAP_SERVICE_CAPTURE_ISSUED_PORT);
	m_memory.writeRamRecordWord(management + HEAP_SERVICE_CAPTURE_BUS_OFFSET, mappedBusSignalsForCartridgeSlot(descriptorSlot));
	for (auto& plane : m_capturedClosureOperands) plane.clear();
	const std::array args{management, RAM_BASE + frame.controlOffset, frame.thread->address,
		RAM_BASE + binding, RAM_BASE + workspace, static_cast<u32>(remainingDeviceCycles())};
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
	const u32 offset = heapServiceResult();
	if (offset == 0u) throw LuaOutOfMemorySignal{};
	if (static_cast<i32>(offset) < 0) throw LuaExecutionError(~offset);
	const u32 address = RAM_BASE + offset;
	const int destination = static_cast<int>(markedDestination - 1u);
	if ((m_memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL) != 0u)
		m_staticClosuresByAddress.insert(m_memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), address);
	CallFrame& frame = *m_activeThread->currentFrame;
	frame.registers.set(destination, valueClosure(address));
	frame.extendTop(destination + 1);
	frame.writeControl(FrameField::Pc, m_memory.readRamRecordWord(base + static_cast<u32>(HeapServiceClosureField::NextPc)));
}
