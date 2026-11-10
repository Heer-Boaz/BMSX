// Shared call/return datapaths, inlined by the interpreter and the native
// dispatcher without duplicating their semantic owner.

inline void CPU::executeClosure(CallFrame& frame, int destination, u32 operand, int flags) {
	const u32 functionAddress = (flags & CLOSURE_ADDRESS_REGISTER_FLAG) != 0
		? toU32(frame.registers[operand]) : operand * BLUA32_FUNCTION_ALIGNMENT;
	if (!readFunctionRecordOnBus(*m_activeExecutionImage, functionAddress, m_executionBusSignals)) {
		hardHalt();
		return;
	}
	Closure* closure = createClosure(frame);
	if (!closure) return;
	frame.registers[destination] = valueClosure(closure);
	frame.top = std::max(frame.top, destination + 1);
}

inline bool CPU::executeCall(CallFrame& frame, int a, int b, int c) {
	const int argCount = decodeCallArgCount(b, std::max(frame.top - a - 1, 0));
	const Value callee = frame.registers[a];
	if (valueIsClosure(callee)) {
		CallFrame* pushed = pushFrame(frame, asClosure(callee), a + 1, argCount, a, c, false,
			frame.pc - INSTRUCTION_BYTES);
		return pushed && m_functionRecordLatch.cacheableRead;
	}
	if (valueIsBuiltinFunction(callee)) {
		runBuiltinFunction(*asBuiltinFunction(callee), frame, a, c, argCount);
		return false;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

inline bool CPU::executeReturn(CallFrame& frame, int a, int b) {
	const int count = b == 0 ? std::max(frame.top - a, 0) : b;
	closeUpvalues(frame);
	if (m_activeThread->protectedCallDepth > 0) {
		const size_t continuationIndex = m_activeThread->protectedCallDepth - 1;
		ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
		if (continuation.target == &frame) {
			finishProtectedCall(continuationIndex, frame, a, count);
			m_activeThread->stackTop = frame.varargBase;
			m_activeThread->leaveFrame();
			return false;
		}
	}
	if (frame.returnToCompletionLatch) {
		m_completionValues.assign(frame.registers + a, frame.registers + a + count);
		m_activeThread->stackTop = frame.varargBase;
		m_activeThread->leaveFrame();
		return false;
	}
	if (m_activeThread->frameDepth == 1 && m_activeThread->resumer != nullptr) {
		Thread* thread = m_activeThread;
		thread->status = ThreadStatus::Dead;
		returnToResumer(frame.registers + a, count, true);
		thread->stackTop = 0;
		thread->leaveFrame();
		return false;
	}
	if (m_activeThread->frameDepth == 1) {
		m_completionValues.assign(frame.registers + a, frame.registers + a + count);
	} else {
		CallFrame& caller = *frame.previous;
		writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, frame, a, count);
	}
	m_activeThread->stackTop = frame.varargBase;
	m_activeThread->leaveFrame();
	return true;
}

inline void CPU::executeVararg(CallFrame& frame, int a, int b) {
	const int count = b == 0 ? frame.varargCount : b;
	if (count != 0) {
		Value* registers = ensureRegisterCapacity(frame, a + count - 1);
		const int copied = std::min(count, frame.varargCount);
		std::copy_n(m_activeThread->stack.data() + frame.varargBase, copied, registers + a);
		std::fill_n(registers + a + copied, count - copied, valueNil());
	}
	frame.top = b == 0 ? a + count : std::max(frame.top, a + count);
}
