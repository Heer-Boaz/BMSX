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
	frame.registers.set(1, valueInteger(remainingDeviceCycles()));
	frame.registers.set(2, valueInteger(static_cast<i32>(m_runKind)));
	if (supplied != 0) caller.extendTop(destination + supplied + 1);
	for (int index = 0; index < supplied; ++index) {
		const Value value = caller.registers.get(destination + 1 + index);
		frame.registers.set(BIOS_CALL_CONTEXT_WORDS + 2 * index, valueInteger(static_cast<i32>(valueTag(value))));
		frame.registers.set(BIOS_CALL_CONTEXT_WORDS + 2 * index + 1, valueInteger(static_cast<i32>(valuePayload(value))));
	}
	armBiosCall(HeapServiceBiosCallKind::Opcode, static_cast<u32>(destination), 0u);
	m_heapServiceView.enterFrame(&frame);
	requestYield();
}

void CPU::armBiosCall(HeapServiceBiosCallKind kind, u32 target, u32 resultWord) {
	const u32 state = m_heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
	m_memory.writeRamRecordPair(state + static_cast<u32>(HeapServiceBiosCallField::Kind), static_cast<u32>(kind), m_currentInstructionPc);
	m_memory.writeRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::LastPc), lastPc);
	m_memory.writeRamRecordPair(state + static_cast<u32>(HeapServiceBiosCallField::ResultBaseOrProtectedIndex), target, resultWord);
}

void CPU::finishBiosCall(HeapServiceBiosCallKind kind) {
	const u32 state = m_heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
	m_memory.writeRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Kind), static_cast<u32>(HeapServiceBiosCallKind::Idle));
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
	if (kind == HeapServiceBiosCallKind::Discard) return;
	const u32 target = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::ResultBaseOrProtectedIndex));
	const auto tag = static_cast<ValueTag>(m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Tag)));
	const u32 word = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::Word));
	const auto value = valueFromTag(tag, word);
	if (kind == HeapServiceBiosCallKind::Opcode) {
		// BIOSCALL defines one slot without truncating the argument window.
		auto& caller = *m_activeThread->currentFrame;
		caller.registers.set(target, value);
		caller.extendTop(static_cast<int>(target + 1u));
		return;
	}
	// Result placement can grow the caller's stack. Keep the tagged value
	// rooted through that existing synchronous owner, as for builtin returns.
	auto scratch = acquireBuiltinResultScratch();
	auto& results = scratch.get();
	results.push_back(value);
	if (kind == HeapServiceBiosCallKind::Protected) {
		finishProtectedCall(target, {nullptr, results.data(), 0, 1});
	} else {
		const u32 resultWord = m_memory.readRamRecordWord(state + static_cast<u32>(HeapServiceBiosCallField::ResultWord));
		writeReturnValues(*m_activeThread->currentFrame, {static_cast<i32>(target), resultWord}, {results.data(), 1});
	}
}
