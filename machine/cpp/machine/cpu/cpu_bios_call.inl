void CPU::armBiosCall(HeapServiceBiosCallKind kind, u32 target, u32 resultWord) {
	const u32 state = m_heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
	m_memory.writeRamRecordPair(state + static_cast<u32>(HeapServiceBiosCallField::Kind), static_cast<u32>(kind), m_currentInstructionPc);
	m_memory.writeRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::LastPc), lastPc);
	m_memory.writeRamRecordPair(state + static_cast<u32>(HeapServiceBiosCallField::ResultBase), target, resultWord);
}

void CPU::finishBiosCall(HeapServiceBiosCallKind kind) {
	const u32 state = m_heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
	m_memory.writeRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Kind), static_cast<u32>(HeapServiceBiosCallKind::Idle));
	m_currentInstructionPc = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	const u32 status = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Status));
	if (status != 0u) {
		retireNumericLuaFault(status - 1u);
		return;
	}
	if (kind == HeapServiceBiosCallKind::Discard) return;
	const u32 target = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::ResultBase));
	const auto tag = static_cast<ValueTag>(m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Tag)));
	const u32 word = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Word));
	const auto value = valueFromTag(tag, word);
	// Result placement can grow the caller's stack. Keep the tagged value
	// rooted through that existing synchronous owner, as for builtin returns.
	auto scratch = acquireBuiltinResultScratch();
	auto& results = scratch.get();
	results.push_back(value);
	const u32 resultWord = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::ResultWord));
	writeReturnValues(*m_activeThread->currentFrame, {static_cast<i32>(target), resultWord}, {results.data(), 1});
}
