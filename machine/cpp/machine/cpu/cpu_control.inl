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
	case COP0_STATUS:
		m_cop0Words[COP0_STATUS] = value;
		break;
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
