// Shared bus-visible scalar transfers. Generated bodies leave for the stable
// dispatcher: a device access can fault, block or retire its executing source.

inline RamAperture CPU::dataAperture(u32 address, u32 bytes) const {
	if (((address < CPU_CONTROL_RAM_END && static_cast<u64>(address) + bytes > CPU_FIXED_FRAME_ADDRESS)
		|| (address & CART_READ_QUALIFIER) != 0u) && supervisorSystemInstruction())
		return RamAperture::SystemData;
	return RamAperture::CpuData;
}

inline void CPU::executeMemoryLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address) {
	if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)]) != 0u) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, address);
		return;
	}
	const auto aperture = dataAperture(address, MEMORY_ACCESS_KIND_BYTE_SIZES[static_cast<size_t>(kind)]);
	if (kind == MemoryAccessKind::Value) {
		const auto* slot = m_memory.readMappedValue(address, aperture);
		if (!slot) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
			return;
		}
		frame.registers.set(destination, valueFromTag(static_cast<ValueTag>(slot[VALUE_MEMORY_TAG_OFFSET]), readLE32(slot)));
		frame.extendTop(destination + 1);
		return;
	}
	const u32 faultSequence = m_memory.readBusFaultSequence();
	Value value;
	switch (kind) {
		case MemoryAccessKind::Word: value = valueInteger(static_cast<i32>(m_memory.readMappedWord(address, aperture))); break;
		case MemoryAccessKind::U8: value = valueInteger(m_memory.readMappedU8(address, aperture)); break;
		case MemoryAccessKind::U16LE: value = valueInteger(m_memory.readMappedU16LE(address, aperture)); break;
		case MemoryAccessKind::U32LE: value = valueInteger(static_cast<i32>(m_memory.readMappedU32LE(address, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, aperture))); break;
		case MemoryAccessKind::F32LE: value = valueFloatBits(m_memory.readMappedU32LE(address, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, aperture)); break;
		case MemoryAccessKind::F64LE: value = valueFloat(static_cast<float>(m_memory.readMappedF64LE(address, aperture))); break;
		case MemoryAccessKind::ContextWord:
			if (!supervisorSystemInstruction() || !fixedInterruptActive()) {
				enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
				return;
			}
			value = valueInteger(static_cast<i32>(m_memory.readMappedBusU32LE(address,
				executionBusSignalsForDomain(static_cast<ExecutionDomainId>(m_exceptionDomainWord)))));
			break;
		default: BMSX_UNREACHABLE();
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
		return;
	}
	frame.registers.set(destination, value);
	frame.extendTop(destination + 1);
}

inline bool CPU::executeMemoryStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address) {
	if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)]) != 0u) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
		return true;
	}
	if (kind == MemoryAccessKind::Value) {
		const Value value = frame.registers.get(source);
		if (!m_memory.writeMappedValue(address, valuePayload(value), static_cast<u8>(valueTag(value)), dataAperture(address, VALUE_MEMORY_SIZE)))
			enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
		return true;
	}
	return continueMemoryStore(frame, source, kind, address);
}

inline bool CPU::continueMemoryStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address) {
	if (!m_memory.mappedWriteReady(address)) {
		m_pendingMemory = {PendingMemoryKind::Store, m_currentInstructionPc, frame.readControl(FrameField::Pc), address, kind, source, 0};
		blockMappedWrite(frame, address);
		return false;
	}
	if (static_cast<size_t>(source) >= frame.registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const Value value = frame.registers.get(source);
	const u32 faultSequence = m_memory.readBusFaultSequence();
	const auto aperture = dataAperture(address, MEMORY_ACCESS_KIND_BYTE_SIZES[static_cast<size_t>(kind)]);
	switch (kind) {
		case MemoryAccessKind::Word: m_memory.writeMappedWord(address, wordOperand(value), aperture); break;
		case MemoryAccessKind::U8: m_memory.writeMappedU8(address, static_cast<u8>(wordOperand(value)), aperture); break;
		case MemoryAccessKind::U16LE: m_memory.writeMappedU16LE(address, wordOperand(value), aperture); break;
		case MemoryAccessKind::U32LE: m_memory.writeMappedU32LE(address, wordOperand(value), BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, aperture); break;
		case MemoryAccessKind::F32LE:
			if (!valueIsNumber(value)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			m_memory.writeMappedU32LE(address, valueIsFloat(value) ? valuePayload(value) : numberToF32Bits(static_cast<float>(asInteger(value))),
				BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, aperture); break;
		case MemoryAccessKind::F64LE:
			if (!valueIsNumber(value)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			m_memory.writeMappedF64LE(address, valueIsInteger(value) ? static_cast<double>(asInteger(value)) : static_cast<double>(asFloat(value)), aperture); break;
		case MemoryAccessKind::Value: // Tagged stores never wait on a bus device.
		case MemoryAccessKind::ContextWord: BMSX_UNREACHABLE();
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
	return continueWordStores(frame, address, source, count);
}

inline bool CPU::continueWordStores(CallFrame& frame, u32 address, int source, int count) {
	const u32 blockedAddress = m_memory.firstBlockedMappedWordWrite(address, count);
	if (blockedAddress != NO_BLOCKED_MAPPED_WRITE) {
		m_pendingMemory = {PendingMemoryKind::WordStores, m_currentInstructionPc, frame.readControl(FrameField::Pc), address, MemoryAccessKind::Word, source, count};
		blockMappedWrite(frame, blockedAddress);
		return false;
	}
	instructionBudgetRemaining -= count;
	const u32 faultSequence = m_memory.readBusFaultSequence();
	const auto aperture = dataAperture(address, count * sizeof(u32));
	const int available = std::clamp(static_cast<int>(frame.registers.size()) - source, 0, count);
	for (int offset = 0; offset < available; ++offset) {
		m_memory.writeMappedWord(address, wordOperand(frame.registers.get(source + offset)), aperture);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
			return true;
		}
		address += 4u;
	}
	if (available != count) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return true;
}

inline void CPU::resumePendingMemoryOperation() {
	const PendingMemoryOperation operation = m_pendingMemory;
	m_pendingMemory.kind = PendingMemoryKind::None;
	CallFrame& frame = *m_activeThread->currentFrame;
	m_currentInstructionPc = operation.instructionPc;
	frame.writeControl(FrameField::Pc, operation.nextPc);
	if (operation.kind == PendingMemoryKind::Store) {
		continueMemoryStore(frame, operation.registerIndex, operation.accessKind, operation.address);
	} else {
		continueWordStores(frame, operation.address, operation.registerIndex, operation.wordCount);
	}
}
