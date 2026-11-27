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
	const auto& record = m_functionRecordLatch;
	const auto domain = record.image->executionDomainId;
	if (record.romBacked && domain == SYSTEM_EXECUTION_DOMAIN_ID) {
		if (record.upvalueCount == 0u
			&& (record.flags & (BLUA32_FUNCTION_CODE | BLUA32_FUNCTION_STATIC)) == (BLUA32_FUNCTION_CODE | BLUA32_FUNCTION_STATIC)) {
			frame.registers.set(destination, valueFromTag(ValueTag::CodeFunction, functionAddress));
			frame.extendTop(destination + 1);
			return;
		}
	}
	const std::array arguments{
		valueInteger(destination), valueInteger(static_cast<i32>(record.address)), valueInteger(domain),
		valueInteger(static_cast<i32>(record.codeAddress)), valueInteger(static_cast<i32>(record.numParams)),
		valueInteger(static_cast<i32>(record.maxStack)), valueInteger(static_cast<i32>(record.flags)),
		valueInteger(static_cast<i32>(record.upvalueTableAddress)), valueInteger(static_cast<i32>(record.upvalueCount)),
		valueInteger(record.romBacked), valueInteger(remainingDeviceCycles()),
	};
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_FUNCTION_BINDING,
		m_currentInstructionPc, arguments);
}

inline bool CPU::executeCall(CallFrame& frame, int a, int supplied, int requested) {
	const int argCount = supplied < 0 ? std::max(frame.readWindow(FrameField::Top) - a - 1, 0) : supplied;
	if (static_cast<size_t>(a) >= frame.registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const auto result = CallResultPlacement::call(a, requested);
	const Value callee = frame.registers.get(a);
	if (valueIsClosure(callee)) {
		const u32 closure = ClosureRecord::recordAddress(m_memory, valuePayload(callee));
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		CallFrame* pushed = pushFrame(frame, closure, a + 1, argCount, result,
			frame.readControl(FrameField::Pc) - INSTRUCTION_BYTES);
		return pushed != nullptr;
	}
	if (valueTag(callee) == ValueTag::CodeFunction) {
		return pushFrame(frame, 0u, a + 1, argCount, result,
			frame.readControl(FrameField::Pc) - INSTRUCTION_BYTES, valuePayload(callee)) != nullptr;
	}
	if (valueIsBuiltinFunction(callee)) {
		// Closures reserve their shared argument window before entry. A
		// builtin borrows existing Thread slots without that placement.
		if (!frame.registers.containsRange(a + 1, argCount)
			&& !frame.thread->stack.containsRange(frame.stackBase() + a + 1, argCount))
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		runBuiltinFunction(m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(callee))], frame, result,
			BuiltinArgsView(frame.thread->stack.subspan(frame.stackBase() + a + 1, argCount)));
		return false;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

inline bool CPU::executeReturn(CallFrame& frame, int a, int produced, bool fromArguments) {
	const int stackBase = frame.stackBase();
	int first = a;
	int available;
	if (fromArguments) {
		if (!frame.registers.containsRange(a, 1)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const int argumentBase = frame.readWindow(FrameField::VarargBase);
		const int extras = std::max(stackBase - argumentBase, 0);
		const Value start = frame.registers.get(a);
		if (!valueIsInteger(start)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const int skip = static_cast<int>(std::min(static_cast<u32>(extras), valuePayload(start)));
		first = argumentBase + skip - stackBase;
		available = extras - skip;
	} else available = std::max(frame.readWindow(FrameField::Top) - a, 0);
	const int count = produced < 0 ? available : fromArguments ? std::min(produced, available) : produced;
	const auto admitSource = [&](int copied) {
		if (!fromArguments && !frame.registers.containsRange(a, copied)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	};
	const bool completes = frame.hasControlFlag(FRAME_COMPLETION);
	if (completes || m_activeThread->frameDepth() == 1) {
		admitSource(count);
		if (frame.readControl(FrameField::OpenHead) != 0u) {
			enterRegisterWindowException(frame, 0u, 0u, OpCode::RET, a);
			return false;
		}
		m_completionValues.reserveCapacity(count);
		if (count != 0) m_completionValues.view().copyFrom(frame.thread->stack, 0, stackBase + first, count);
		m_completionValueCount = count;
		instructionBudgetRemaining -= count;
	} else {
		CallFrame& caller = *frame.previous;
		const auto result = CallResultPlacement::frame(frame.readWindow(FrameField::ReturnBase),
			frame.readWindow(FrameField::ReturnCount), frame.readControl(FrameField::Flags));
		const auto placement = ValuePlacement::fit(count, result.selected(count));
		admitSource(placement.copied);
		const int selected = placement.count(), end = result.base + selected;
		int capacity = 0;
		if (selected != 0 && end > caller.stackCapacity()) {
			capacity = admitRegisterWindow(frame, caller, end, OpCode::RET, a);
			if (capacity == 0) return false;
		}
		if (frame.readControl(FrameField::OpenHead) != 0u) {
			enterRegisterWindowException(frame, 0u, 0u, OpCode::RET, a);
			return false;
		}
		if (capacity != 0) caller.growRegisterWindow(capacity);
		const int source = stackBase + first;
		const int top = !result.extendsTop() || end > caller.readWindow(FrameField::Top) ? end : -1;
		placeRegisterWindow(caller, result.base, source, placement.copied, placement.padded, top);
	}
	m_activeThread->leaveFrame();
	resumeFrameBank();
	return !completes;
}

inline bool CPU::executeVararg(CallFrame& frame, int a, int requested) {
	const int available = frame.varargCount();
	const auto placement = ValuePlacement::fit(available, requested < 0 ? available : requested);
	const int count = placement.count(), end = a + count;
	const int top = requested < 0 || (count != 0 && end > frame.readWindow(FrameField::Top)) ? end : -1;
	if (count == 0) {
		if (top >= 0) frame.setTop(top);
		return false;
	}
	const int source = frame.readWindow(FrameField::VarargBase);
	if (end > frame.stackCapacity()) {
		const int capacity = admitRegisterWindow(frame, frame, end, OpCode::VARARG, a);
		if (capacity == 0) return true;
		frame.growRegisterWindow(capacity);
	}
	placeRegisterWindow(frame, a, source, placement.copied, placement.padded, top);
	return false;
}

inline int CPU::admitRegisterWindow(CallFrame& issuer, const CallFrame& receiver, int end, OpCode opcode, int a) {
	const auto capacity = registerWindowBucket(static_cast<size_t>(end));
	const auto extent = static_cast<size_t>(receiver.stackBase()) + capacity;
	if (extent <= receiver.thread->stackCapacity) return static_cast<int>(capacity);
	if (resetBankSelected()) enterSynchronousException(issuer, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
	else enterRegisterWindowException(issuer, static_cast<u32>(extent), 0u, opcode, a);
	return 0;
}

inline void CPU::placeRegisterWindow(CallFrame& frame, int destination, int source, int copied, int padded, int top) {
	frame.registers.copyFrom(frame.thread->stack, destination, source, copied, padded);
	instructionBudgetRemaining -= copied + padded;
	if (top >= 0) frame.setTop(top);
}
