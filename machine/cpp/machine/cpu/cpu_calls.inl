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
	if (m_functionRecordLatch.romBacked && m_functionRecordLatch.image->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID
		&& (m_functionRecordLatch.flags & BLUA32_FUNCTION_RESIDENT) != 0u) {
		frame.registers.set(destination, valueResidentFunction(functionAddress));
		frame.extendTop(destination + 1);
		return;
	}
	const u32 closure = createClosure(frame, destination);
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
			frame.readControl(FrameField::Pc) - INSTRUCTION_BYTES, true);
		return pushed != nullptr;
	}
	if (valueTag(callee) == ValueTag::ResidentFunction) {
		const CallValueSource arguments{&frame, nullptr, a + 1, argCount};
		// The source is an existing Value window, not a request to grow it.
		if (!frame.registers.containsRange(a + 1, argCount)
			&& !frame.thread->stack.containsRange(frame.stackBase() + a + 1, argCount))
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		beginResidentCall(valuePayload(callee), arguments.values(), result);
		return false;
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
		finishProtectedCall(continuation, {&frame, nullptr, a, count});
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
		returnToResumer({&frame, nullptr, a, copied}, true);
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
		const auto placement = ValuePlacement::fit(count, result.selected(count));
		admitAndClose(placement.copied);
		const int selected = placement.count(), end = result.base + selected;
		const int source = frame.stackBase() + a;
		const int top = !result.extendsTop() || end > caller.readWindow(FrameField::Top) ? end : -1;
		if (selected != 0 && end > caller.stackCapacity()
			&& acquireRegisterWindow(caller, result.base, source, placement.copied, placement.padded, top, end,
				FRAME_RESIDENT_RETIRE_WINDOW_SOURCE)) return false;
		placeRegisterWindow(caller, result.base, source, placement.copied, placement.padded, top);
	}
	m_activeThread->leaveFrame();
	resumeFrameBank();
	return true;
}

inline bool CPU::executeVararg(CallFrame& frame, int a, int requested) {
	const int available = frame.readWindow(FrameField::VarargCount);
	const auto placement = ValuePlacement::fit(available, requested < 0 ? available : requested);
	const int count = placement.count(), end = a + count;
	const int top = requested < 0 || (count != 0 && end > frame.readWindow(FrameField::Top)) ? end : -1;
	if (count == 0) {
		if (top >= 0) frame.setTop(top);
		return false;
	}
	const int source = frame.readWindow(FrameField::VarargBase);
	if (end > frame.stackCapacity() && acquireRegisterWindow(frame, a, source, placement.copied, placement.padded, top, end, 0u)) return true;
	placeRegisterWindow(frame, a, source, placement.copied, placement.padded, top);
	return false;
}

inline bool CPU::acquireRegisterWindow(CallFrame& frame, int destination, int source, int copied, int padded,
	int top, int end, u32 receiverFlags) {
	auto& thread = *frame.thread;
	const auto capacity = registerWindowBucket(static_cast<size_t>(end));
	const auto extent = static_cast<size_t>(frame.stackBase()) + capacity;
	if (extent > thread.stackCapacity) {
		const u32 function = m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::ReserveFrameSpace)];
		if (function != 0u) {
			const u32 prepared = m_heapAllocator.managementOffset() + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
			using Window = PreparedWindowField;
			m_memory.writeRamRecordPair(prepared + static_cast<u32>(Window::Destination), destination, source);
			m_memory.writeRamRecordPair(prepared + static_cast<u32>(Window::Copied), copied, padded);
			m_memory.writeRamRecordPair(prepared + static_cast<u32>(Window::Capacity), static_cast<u32>(capacity), static_cast<u32>(top));
			// Both Closure roots are already edges of this live Thread.
			beginFrameSpaceAcquisition(function, static_cast<u32>(extent), 0, 0, FRAME_RESIDENT_PLACE_WINDOW | receiverFlags);
			return true;
		}
		thread.resizeStack(nextPowerOfTwo(extent));
	}
	frame.growRegisterWindow(static_cast<int>(capacity));
	return false;
}

inline void CPU::placeRegisterWindow(CallFrame& frame, int destination, int source, int copied, int padded, int top) {
	frame.registers.copyFrom(frame.thread->stack, destination, source, copied, padded);
	instructionBudgetRemaining -= copied + padded;
	if (top >= 0) frame.setTop(top);
}
