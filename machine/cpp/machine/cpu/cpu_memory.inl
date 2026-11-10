// Shared bus-visible scalar transfers. Generated bodies leave for the stable
// dispatcher: a device access can fault, block or retire its executing source.

inline void CPU::executeMemoryLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address) {
	if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)]) != 0u) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, address);
		return;
	}
	const u32 faultSequence = m_memory.readBusFaultSequence();
	Value value;
	switch (kind) {
		case MemoryAccessKind::Word: value = valueNumber(m_memory.readMappedWord(address)); break;
		case MemoryAccessKind::U8: value = valueNumber(m_memory.readMappedU8(address)); break;
		case MemoryAccessKind::U16LE: value = valueNumber(m_memory.readMappedU16LE(address)); break;
		case MemoryAccessKind::U32LE: value = valueNumber(m_memory.readMappedU32LE(address)); break;
		case MemoryAccessKind::F32LE: value = valueNumber(m_memory.readMappedF32LE(address)); break;
		case MemoryAccessKind::F64LE: value = valueNumber(m_memory.readMappedF64LE(address)); break;
		default: __builtin_unreachable();
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
		return;
	}
	frame.registers[destination] = value;
	frame.top = std::max(frame.top, destination + 1);
}

inline bool CPU::executeMemoryStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address) {
	if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)]) != 0u) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
		return true;
	}
	if (!m_memory.mappedWriteReady(address)) {
		blockMappedWrite(frame, address);
		return false;
	}
	const Value value = frame.registers[source];
	const u32 faultSequence = m_memory.readBusFaultSequence();
	switch (kind) {
		case MemoryAccessKind::Word: m_memory.writeMappedWord(address, toU32(value)); break;
		case MemoryAccessKind::U8: m_memory.writeMappedU8(address, static_cast<u8>(toU32(value))); break;
		case MemoryAccessKind::U16LE: m_memory.writeMappedU16LE(address, toU32(value)); break;
		case MemoryAccessKind::U32LE: m_memory.writeMappedU32LE(address, toU32(value)); break;
		case MemoryAccessKind::F32LE: m_memory.writeMappedF32LE(address, static_cast<float>(decodeNumber(value))); break;
		case MemoryAccessKind::F64LE: m_memory.writeMappedF64LE(address, decodeNumber(value)); break;
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	}
	return true;
}

inline bool CPU::executeWordStores(CallFrame& frame, u32 address, int source, int count) {
	if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(MemoryAccessKind::Word)]) != 0u) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
		return true;
	}
	const u32 blockedAddress = m_memory.firstBlockedMappedWordWrite(address, count);
	if (blockedAddress != NO_BLOCKED_MAPPED_WRITE) {
		blockMappedWrite(frame, blockedAddress);
		return false;
	}
	instructionBudgetRemaining -= ceilDiv4(count);
	const u32 faultSequence = m_memory.readBusFaultSequence();
	for (int offset = 0; offset < count; ++offset) {
		m_memory.writeMappedWord(address, toU32(frame.registers[source + offset]));
		if (m_memory.readBusFaultSequence() != faultSequence) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
			return true;
		}
		address += 4u;
	}
	return true;
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
NativeBlockTransition CPU::compiledReadMemoryExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit) {
	const int a = exit->exitA, b = exit->exitB;
	const auto kind = static_cast<MemoryAccessKind>(exit->exitC);
	const u32 displacement = exit->displaced ? static_cast<u32>(exit->displacement) << 2u : 0u;
	const u32 address = toU32(readRK(*frame->executionImage, frame->registers, b)) + displacement;
	cpu->executeMemoryLoad(*frame, a, kind, address);
	return NativeBlockTransition::Redispatch;
}

NativeBlockTransition CPU::compiledWriteMemoryExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit) {
	const int a = exit->exitA, b = exit->exitB;
	const auto kind = static_cast<MemoryAccessKind>(exit->exitC);
	const u32 displacement = exit->displaced ? static_cast<u32>(exit->displacement) << 2u : 0u;
	const u32 address = toU32(readRK(*frame->executionImage, frame->registers, b)) + displacement;
	cpu->executeMemoryStore(*frame, a, kind, address);
	return NativeBlockTransition::Redispatch;
}

NativeBlockTransition CPU::compiledWriteWordsExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit) {
	const int a = exit->exitA, b = exit->exitB, count = exit->exitC;
	const u32 displacement = exit->displaced ? static_cast<u32>(exit->displacement) << 2u : 0u;
	const u32 address = toU32(readRK(*frame->executionImage, frame->registers, b)) + displacement;
	// A write may retire the source descriptor; no descriptor access follows it.
	cpu->executeWordStores(*frame, address, a, count);
	return NativeBlockTransition::Redispatch;
}
#endif
