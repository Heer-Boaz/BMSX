// Shared call/return datapaths. Included in cpu.cpp so the interpreter keeps
// its inlining opportunities and native exits share the same semantic owner.

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
			auto finished = std::move(m_activeThread->frames.back());
			m_activeThread->frames.pop_back();
			m_activeThread->stackTop = finished->varargBase;
			releaseFrame(std::move(finished));
			return false;
		}
	}
	if (frame.returnToCompletionLatch) {
		m_completionValues.assign(frame.registers + a, frame.registers + a + count);
		auto finished = std::move(m_activeThread->frames.back());
		m_activeThread->frames.pop_back();
		m_activeThread->stackTop = finished->varargBase;
		releaseFrame(std::move(finished));
		return false;
	}
	if (m_activeThread->frames.size() == 1 && m_activeThread->resumer != nullptr) {
		Thread* thread = m_activeThread;
		thread->status = ThreadStatus::Dead;
		returnToResumer(frame.registers + a, count, true);
		auto finished = std::move(thread->frames.back());
		thread->frames.pop_back();
		thread->stackTop = 0;
		releaseFrame(std::move(finished));
		return false;
	}
	if (m_activeThread->frames.size() == 1) {
		m_completionValues.assign(frame.registers + a, frame.registers + a + count);
	} else {
		CallFrame& caller = *m_activeThread->frames[m_activeThread->frames.size() - 2];
		writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, frame, a, count);
	}
	auto finished = std::move(m_activeThread->frames.back());
	m_activeThread->frames.pop_back();
	m_activeThread->stackTop = finished->varargBase;
	releaseFrame(std::move(finished));
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
