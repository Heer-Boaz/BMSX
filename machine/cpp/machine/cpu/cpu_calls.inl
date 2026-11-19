// Shared call/return datapaths, inlined by the interpreter and the native
// dispatcher without duplicating their semantic owner.

inline void CPU::executeClosure(CallFrame& frame, int destination, u32 operand, int flags) {
	const u32 functionAddress = (flags & CLOSURE_ADDRESS_REGISTER_FLAG) != 0
		? wordOperand(frame.registers.get(operand)) : operand * BLUA32_FUNCTION_ALIGNMENT;
	if (!readFunctionRecordOnBus(*m_activeExecutionImage, functionAddress, m_executionBusSignals)) {
		hardHalt();
		return;
	}
	Closure* closure = createClosure(frame);
	if (!closure) return;
	frame.registers.set(destination, valueClosure(m_heap.reference(closure)));
	frame.top = std::max(frame.top, destination + 1);
}

inline bool CPU::executeCall(CallFrame& frame, int a, int b, int c) {
	const int argCount = decodeValueCount(b, std::max(frame.top - a - 1, 0));
	const Value callee = frame.registers.get(a);
	if (valueIsClosure(callee)) {
		Closure* closure = asClosure(callee, m_heap);
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		CallFrame* pushed = pushFrame(frame, closure, a + 1, argCount, a, c, false,
			frame.pc - INSTRUCTION_BYTES);
		return pushed != nullptr;
	}
	if (valueIsBuiltinFunction(callee)) {
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(callee))], frame, a, c, argCount);
		return false;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

inline bool CPU::executeReturn(CallFrame& frame, int a, int b) {
	const int count = decodeValueCount(b, std::max(frame.top - a, 0));
	instructionBudgetRemaining -= closeUpvalues(frame);
	if (frame.protectedContinuationIndex >= 0) {
		finishProtectedCall(static_cast<size_t>(frame.protectedContinuationIndex), frame, a, count);
		m_activeThread->leaveFrame();
		return false;
	}
	if (frame.returnToCompletionLatch) {
		m_completionValues.reserveCapacity(count);
		m_completionValues.view().copyFrom(frame.registers, 0, a, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
		m_activeThread->leaveFrame();
		return false;
	}
	if (m_activeThread->frameDepth == 1 && m_activeThread->resumer() != nullptr) {
		Thread* thread = m_activeThread;
		thread->setStatus(ThreadStatus::Dead);
		returnToResumer(frame.stackBase + a, count, true);
		thread->stackTop = 0;
		thread->leaveFrame();
		return false;
	}
	if (m_activeThread->frameDepth == 1) {
		m_completionValues.reserveCapacity(count);
		m_completionValues.view().copyFrom(frame.registers, 0, a, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
	} else {
		CallFrame& caller = *frame.previous;
		writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, frame, a, count);
	}
	m_activeThread->leaveFrame();
	return true;
}

inline void CPU::executeVararg(CallFrame& frame, int a, int b) {
	const int count = decodeValueCount(b, frame.varargCount);
	if (count != 0) {
		ValueSpan registers = ensureRegisterCapacity(frame, a + count - 1);
		const int copied = std::min(count, frame.varargCount);
		registers.copyFrom(m_activeThread->stack, a, frame.varargBase, copied);
		registers.clear(a + copied, count - copied);
	}
	instructionBudgetRemaining -= count;
	if (b == 0) frame.top = a + count;
	else if (count != 0) frame.top = std::max(frame.top, a + count);
}
