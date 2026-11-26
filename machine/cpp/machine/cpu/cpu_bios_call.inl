void CPU::enterBiosCall(CallFrame& caller, int destination, u32 selector, int supplied) {
	if (selector >= BIOS_CALL_ARITY.size() || supplied != BIOS_CALL_ARITY[selector]) {
		enterSynchronousException(caller, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return;
	}
	const u32 entry = m_systemImage->heapServiceFunctions[static_cast<u32>(HeapServiceOperation::Count) + selector];
	if (entry == 0u) {
		enterSynchronousException(caller, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return;
	}
	const u32 management = m_heapAllocator.managementOffset();
	auto& frame = prepareHeapServiceFrame(entry, 0, BIOS_CALL_CONTEXT_WORDS + 2 * supplied, {}, m_currentInstructionPc);
	frame.registers.set(0, valueInteger(static_cast<i32>(management)));
	frame.registers.set(1, valueInteger(std::max(0, instructionBudgetRemaining)));
	frame.registers.set(2, valueInteger(static_cast<i32>(m_runKind)));
	caller.extendTop(destination + supplied + 1);
	for (int index = 0; index < supplied; ++index) {
		const Value value = caller.registers.get(destination + 1 + index);
		frame.registers.set(BIOS_CALL_CONTEXT_WORDS + 2 * index, valueInteger(static_cast<i32>(valueTag(value))));
		frame.registers.set(BIOS_CALL_CONTEXT_WORDS + 2 * index + 1, valueInteger(static_cast<i32>(valuePayload(value))));
	}
	const u32 state = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
	m_memory.writeRamRecordPair(state + static_cast<u32>(HeapServiceBiosCallField::Destination), static_cast<u32>(destination + 1), m_currentInstructionPc);
	m_memory.writeRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::LastPc), lastPc);
	m_heapServiceView.enterFrame(&frame);
	requestYield();
}

void CPU::finishBiosCall(u32 destination) {
	const u32 state = m_heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
	m_memory.writeRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Destination), 0u);
	m_currentInstructionPc = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::InstructionPc));
	lastPc = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	const u32 status = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Status));
	if (status != 0u) {
		const u32 reason = status - 1u;
		const auto error = m_luaFaultErrorValues[reason];
		if (!handleThreadError(error)) enterLuaFaultException(reason, error);
		return;
	}
	auto& caller = *m_activeThread->currentFrame;
	const auto tag = static_cast<ValueTag>(m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Tag)));
	const u32 word = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Word));
	caller.registers.set(destination - 1u, valueFromTag(tag, word));
	// The argument window remains part of the caller; this definition
	// overwrites only the declared destination.
}
