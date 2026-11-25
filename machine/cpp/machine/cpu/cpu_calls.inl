// Shared call/return datapaths, inlined by the interpreter and the native
// dispatcher without duplicating their semantic owner.

inline void CPU::executeClosure(CallFrame& frame, int destination, u32 operand, int flags) {
	const bool addressInRegister = (flags & CLOSURE_ADDRESS_REGISTER_FLAG) != 0;
	if (static_cast<size_t>(destination) >= frame.registers.size()
		|| (addressInRegister && operand >= frame.registers.size())) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 functionAddress = addressInRegister
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
	if (static_cast<size_t>(a) >= frame.registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
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
		// Closures reserve their shared argument window before entry. A
		// builtin borrows existing Thread slots without that placement.
		if (!frame.registers.containsRange(a + 1, argCount)
			&& !frame.thread->stack.containsRange(frame.stackBase() + a + 1, argCount))
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(callee))], frame, result, {&frame, nullptr, a + 1, argCount});
		return false;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

inline bool CPU::executeReturn(CallFrame& frame, int a, int produced) {
	const int count = produced < 0 ? std::max(frame.readWindow(FrameField::Top) - a, 0) : produced;
	const auto admitAndClose = [&](int copied) {
		if (!frame.registers.containsRange(a, copied)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		instructionBudgetRemaining -= closeUpvalues(frame);
	};
	const u32 continuation = frame.readControl(FrameField::Protected);
	if (static_cast<i32>(continuation) >= 0) {
		const u32 flags = m_activeThread->protectedWord(continuation, ProtectedField::Flags);
		const auto result = m_activeThread->protectedResult(continuation);
		const int copied = (flags & PROTECTED_CALL_KIND_MASK) == static_cast<u32>(ProtectedCallKind::XPCallHandler)
			? std::min(count, 1)
			: (flags & PROTECTED_CALL_PARENT) != 0u && result.extendsTop() ? 0
			: std::clamp(result.selected(count + 1) - 1, 0, count);
		admitAndClose(copied);
		finishProtectedCall(continuation, frame, a, count);
		m_activeThread->leaveFrame();
		resumeFrameBank();
		return false;
	}
	if (frame.hasControlFlag(FRAME_COMPLETION)) {
		admitAndClose(count);
		m_completionValues.reserveCapacity(count);
		m_completionValues.view().copyFrom(frame.registers, 0, a, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
		m_activeThread->leaveFrame();
		resumeFrameBank();
		return false;
	}
	const bool root = m_activeThread->frameDepth() == 1;
	const u32 resumer = root ? m_activeThread->resumer() : 0u;
	if (resumer != 0u) {
		Thread* thread = m_activeThread;
		const CallResultPlacement result{0, ThreadRecord::read(m_memory, resumer, ThreadField::ReturnCount)};
		const int copied = std::clamp(result.selected(count + 1) - 1, 0, count);
		admitAndClose(copied);
		thread->setStatus(ThreadStatus::Dead);
		returnToResumer(copied == 0 ? BuiltinArgsView{} : BuiltinArgsView(frame.registers.subspan(a, copied)), true);
		thread->setStackTop(0);
		thread->leaveFrame();
		return false;
	}
	if (root) {
		admitAndClose(count);
		m_completionValues.reserveCapacity(count);
		m_completionValues.view().copyFrom(frame.registers, 0, a, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
	} else {
		CallFrame& caller = *frame.previous;
		const auto result = CallResultPlacement::frame(frame.readWindow(FrameField::ReturnBase),
			frame.readWindow(FrameField::ReturnCount), frame.readControl(FrameField::Flags));
		admitAndClose(std::min(count, result.selected(count)));
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
		ValueSpan& registers = ensureRegisterCapacity(frame, a + count - 1);
		registers.copyFrom(m_activeThread->stack, a, frame.readWindow(FrameField::VarargBase), placement.copied);
		registers.clear(a + placement.copied, placement.padded);
	}
	instructionBudgetRemaining -= count;
	if (requested < 0) frame.setTop(a + count);
	else if (count != 0) frame.extendTop(a + count);
}
