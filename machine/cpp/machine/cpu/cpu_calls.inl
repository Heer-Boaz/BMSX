// Shared call/return datapaths, inlined by the interpreter and the native
// dispatcher without duplicating their semantic owner.

inline void CPU::executeClosure(CallFrame& frame, int destination, u32 operand, int flags) {
	const u32 functionAddress = (flags & CLOSURE_ADDRESS_REGISTER_FLAG) != 0
		? wordOperand(frame.registers.get(operand)) : operand * BLUA32_FUNCTION_ALIGNMENT;
	if (!readFunctionRecordOnBus(*m_activeExecutionImage, functionAddress, m_executionBusSignals)) {
		hardHalt();
		return;
	}
	const u32 closure = createClosure(frame);
	if (!closure) return;
	frame.registers.set(destination, valueClosure(closure));
	frame.extendTop(destination + 1);
}

inline bool CPU::executeCall(CallFrame& frame, int a, int supplied, int requested) {
	const int argCount = supplied < 0 ? std::max(frame.readWindow(FrameField::Top) - a - 1, 0) : supplied;
	const auto result = CallResultPlacement::call(a, requested);
	const Value callee = frame.registers.get(a);
	if (valueIsClosure(callee)) {
		const u32 closure = asClosure(callee, m_heap);
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		CallFrame* pushed = pushFrame(frame, closure, a + 1, argCount, result,
			frame.readControl(FrameField::Pc) - INSTRUCTION_BYTES);
		return pushed != nullptr;
	}
	if (valueIsBuiltinFunction(callee)) {
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(callee))], frame, result, {&frame, nullptr, a + 1, argCount});
		return false;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

inline bool CPU::executeReturn(CallFrame& frame, int a, int produced) {
	const int count = produced < 0 ? std::max(frame.readWindow(FrameField::Top) - a, 0) : produced;
	instructionBudgetRemaining -= closeUpvalues(frame);
	const u32 continuation = frame.readControl(FrameField::Protected);
	if (static_cast<i32>(continuation) >= 0) {
		finishProtectedCall(continuation, frame, a, count);
		m_activeThread->leaveFrame();
		resumeFrameBank();
		return false;
	}
	if (frame.hasControlFlag(FRAME_COMPLETION)) {
		m_completionValues.reserveCapacity(count);
		m_completionValues.view().copyFrom(frame.registers, 0, a, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
		m_activeThread->leaveFrame();
		resumeFrameBank();
		return false;
	}
	if (m_activeThread->frameDepth() == 1 && m_activeThread->resumer() != 0u) {
		Thread* thread = m_activeThread;
		thread->setStatus(ThreadStatus::Dead);
		returnToResumer(BuiltinArgsView(frame.registers.subspan(a, count)), true);
		thread->setStackTop(0);
		thread->leaveFrame();
		return false;
	}
	if (m_activeThread->frameDepth() == 1) {
		m_completionValues.reserveCapacity(count);
		m_completionValues.view().copyFrom(frame.registers, 0, a, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
	} else {
		CallFrame& caller = *frame.previous;
		const auto result = CallResultPlacement::frame(frame.readWindow(FrameField::ReturnBase),
			frame.readWindow(FrameField::ReturnCount), frame.readControl(FrameField::Flags));
		writeReturnValuesFromRegisters(caller, result, frame, a, count);
	}
	m_activeThread->leaveFrame();
	resumeFrameBank();
	return true;
}

inline void CPU::executeVararg(CallFrame& frame, int a, int requested) {
	const int available = frame.readWindow(FrameField::VarargCount);
	const auto placement = ValuePlacement::fit(available, requested < 0 ? available : requested);
	const int count = placement.count();
	if (count != 0) {
		ValueSpan registers = ensureRegisterCapacity(frame, a + count - 1);
		registers.copyFrom(m_activeThread->stack, a, frame.readWindow(FrameField::VarargBase), placement.copied);
		registers.clear(a + placement.copied, placement.padded);
	}
	instructionBudgetRemaining -= count;
	if (requested < 0) frame.setTop(a + count);
	else if (count != 0) frame.extendTop(a + count);
}
