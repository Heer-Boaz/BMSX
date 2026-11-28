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
	case COP0_EPC:
	case COP0_TABLE_LOOKUP_KEY:
	case COP0_TABLE_ASSIGN_KEY:
	case COP0_TABLE_LENGTH_KEY:
	case COP0_STRING_INDEX_TABLE:
		m_cop0Words[field] = value;
		break;
	case COP0_EXEC:
		executeFunctionAddress(value);
		return;
	case COP0_CONTEXT:
		activateRootContext(value);
		return;
	case COP0_CURRENT:
		selectExecutionContext(frame, value);
		return;
	case COP0_RAM_END:
		selectRamEnd(frame, value);
		return;
	case COP0_SYSTEM_VECTOR:
	case COP0_IRQ_VECTOR:
		installSystemVector(frame, value, field);
		return;
	case COP0_EXCEPTION_TARGET:
		transferExceptionVector(frame, value);
		return;
	case COP0_PREVIOUS_ACTIVE:
	case COP0_EVENT_CYCLES:
	case COP0_BAD_ADDRESS:
	case COP0_LUA_FAULT_REASON:
	case COP0_CAUSE:
		break;
	default:
		hardHalt();
		break;
	}
}
