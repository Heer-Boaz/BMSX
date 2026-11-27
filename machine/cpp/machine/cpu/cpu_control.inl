// Shared privileged control-write datapath. Admission precedes source
// conversion; even ignored/unknown fields retain that conversion's faults.
inline void CPU::executeControlWrite(CallFrame& frame, int source, int field) {
	if (isUserMode()) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	if (static_cast<size_t>(source) >= frame.registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 value = wordOperand(frame.registers.get(source));
	switch (field) {
	case COP0_STATUS: {
		const u32 writeMask = m_activeExecutionDomainId == SYSTEM_EXECUTION_DOMAIN_ID
			&& m_currentInstructionPc - SYSTEM_ROM_BASE < SYSTEM_ROM_SIZE ? ~0u : ~CPU_STATUS_INHIBIT_RESET;
		const u32 previous = m_cop0Words[COP0_STATUS];
		const u32 status = (previous & ~writeMask) | (value & writeMask);
		m_cop0Words[COP0_STATUS] = status;
		if ((previous & ~status & CPU_STATUS_INHIBIT_RESET) != 0u) requestYield();
		break;
	}
	case COP0_RAM_END: {
		if (m_activeExecutionDomainId != SYSTEM_EXECUTION_DOMAIN_ID
			|| m_currentInstructionPc - SYSTEM_ROM_BASE >= SYSTEM_ROM_SIZE) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		const u32 end = value & ~(HEAP_PAGE_SIZE - 1u);
		if (end < DYNAMIC_RAM_BASE || end > RAM_BASE + m_memory.ramByteCount() - RUNTIME_MANAGEMENT_SIZE) {
			enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, value);
			return;
		}
		m_memory.setRamBusEnd(end);
		requestYield();
		return;
	}
	case COP0_EPC:
		m_cop0Words[COP0_EPC] = value;
		break;
	case COP0_EXEC:
		executeFunctionAddress(value);
		return;
	case COP0_BAD_ADDRESS:
	case COP0_LUA_FAULT_REASON:
	case COP0_CAUSE:
		break;
	default:
		hardHalt();
		break;
	}
}
