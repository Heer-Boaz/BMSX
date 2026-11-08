DISPATCH_LABEL(WIDE) {
	hardHalt();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MOV) {
	const int a = decoded->a;
	const int b = decoded->b;
	SET_REGISTER_FAST(a, REG(b));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LOADK) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	SET_REGISTER_FAST(a, IMAGE.constPool[static_cast<size_t>(bx)]);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LOADNIL) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (b != 0) {
		std::fill_n(registers + a, b, valueNil());
		const int nextTop = a + b;
		if (nextTop > FRAME.top) {
			FRAME.top = nextTop;
		}
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KNIL) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueNil());
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KFALSE) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueBool(false));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KTRUE) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueBool(true));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(K0) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueNumber(0.0));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(K1) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueNumber(1.0));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KM1) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueNumber(-1.0));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KSMI) {
	const int a = decoded->a;
	const int sbx = decoded->sbx;
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(sbx)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETSYS) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	SET_REGISTER_FAST(a, m_systemGlobalValues[static_cast<size_t>(bx)]);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETSYS) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	m_systemGlobalValues[static_cast<size_t>(bx)] = REG(a);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETGL) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	SET_REGISTER_FAST(a, m_globalValues[static_cast<size_t>(bx)]);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETGL) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	m_globalValues[static_cast<size_t>(bx)] = REG(a);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETI) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const Value& tableValue = REG(b);
	if (valueIsTable(tableValue)) {
		Table* table = asTable(tableValue);
		Value value;
		if (!table->metatable && table->getIntegerArrayKey(c, value)) {
			SET_REGISTER_FAST(a, value);
			DISPATCH_NEXT();
		}
	}
	SET_REGISTER_FAST(a, loadTableIntegerIndex(tableValue, c));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETI) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	const Value& tableValue = REG(a);
	const Value& value = readRK(IMAGE, registers, rkC);
	if (valueIsTable(tableValue)
		&& asTable(tableValue)->setIntegerArrayKey(b, value)) {
		DISPATCH_NEXT();
	}
	storeTableIntegerIndex(tableValue, b, value);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETFIELD) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	SET_REGISTER_FAST(a, loadTableFieldIndexCached(
		TABLE_CACHE_SLOT(),
		REG(b),
		asStringId(IMAGE.constPool[static_cast<size_t>(c)])
	));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETFIELD) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	storeTableFieldIndexCached(
		TABLE_CACHE_SLOT(),
		REG(a),
		asStringId(IMAGE.constPool[static_cast<size_t>(b)]),
		readRK(IMAGE, registers, rkC)
	);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SELF) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const Value base = REG(b);
	const StringId key = asStringId(IMAGE.constPool[static_cast<size_t>(c)]);
	SET_REGISTER_FAST(a + 1, base);
	SET_REGISTER_FAST(a, loadTableFieldIndexCached(TABLE_CACHE_SLOT(), base, key));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(HALT) {
	haltUntilIrq();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETT) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	const Value& tableValue = REG(b);
	const Value& key = readRK(IMAGE, registers, rkC);
	if (valueIsTable(tableValue) && valueIsNumber(key)) {
		Table* table = asTable(tableValue);
		Value value;
		if (!table->metatable && table->getNumberArrayKey(asNumber(key), value)) {
			SET_REGISTER_FAST(a, value);
			DISPATCH_NEXT();
		}
	}
	SET_REGISTER_FAST(a, loadTableIndex(tableValue, key));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETT) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& tableValue = REG(a);
	const Value& key = readRK(IMAGE, registers, rkB);
	const Value& value = readRK(IMAGE, registers, rkC);
	if (valueIsTable(tableValue)
		&& valueIsNumber(key)
		&& asTable(tableValue)->setNumberArrayKey(asNumber(key), value)) {
		DISPATCH_NEXT();
	}
	storeTableIndex(tableValue, key, value);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(NEWT) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	auto* table = createTable(b, c);
	SET_REGISTER_FAST(a, valueTable(table));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(ADD) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	SET_REGISTER_FAST(a, valueNumber(asNumber(left) + asNumber(right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SUB) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	SET_REGISTER_FAST(a, valueNumber(asNumber(left) - asNumber(right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MUL) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	SET_REGISTER_FAST(a, valueNumber(asNumber(left) * asNumber(right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(DIV) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	SET_REGISTER_FAST(a, valueNumber(asNumber(left) / asNumber(right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MOD) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	const double left = asNumber(leftValue);
	const double right = asNumber(rightValue);
	SET_REGISTER_FAST(a, valueNumber(luaModulo(left, right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(FLOORDIV) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	SET_REGISTER_FAST(a, valueNumber(luaFloorDivide(asNumber(left), asNumber(right))));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(POW) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	SET_REGISTER_FAST(a, valueNumber(luaPow(asNumber(left), asNumber(right))));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BAND) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	const uint32_t left = toU32(leftValue);
	const uint32_t right = toU32(rightValue);
	const int32_t result = static_cast<int32_t>(left & right);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BOR) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	const uint32_t left = toU32(leftValue);
	const uint32_t right = toU32(rightValue);
	const int32_t result = static_cast<int32_t>(left | right);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BXOR) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	const uint32_t left = toU32(leftValue);
	const uint32_t right = toU32(rightValue);
	const int32_t result = static_cast<int32_t>(left ^ right);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SHL) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	const uint32_t left = toU32(leftValue);
	const uint32_t right = toU32(rightValue) & 31u;
	const uint32_t result = left << right;
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(static_cast<int32_t>(result))));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SHR) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	const int32_t left = toI32(leftValue);
	const uint32_t right = toU32(rightValue) & 31u;
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(left >> right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CONCAT) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value left = readRK(IMAGE, registers, rkB);
	const Value right = readRK(IMAGE, registers, rkC);
	size_t stringByteCount = 0;
	if (valueIsString(left)) {
		stringByteCount += m_stringPool.toString(asStringId(left)).size();
	}
	if (valueIsString(right)) {
		stringByteCount += m_stringPool.toString(asStringId(right)).size();
	}
	std::string text;
	text.reserve(stringByteCount);
	appendValueString(text, left, m_stringPool);
	appendValueString(text, right, m_stringPool);
	const StringId textId = m_stringPool.internOwned(std::move(text));
	SET_REGISTER_FAST(a, valueString(textId));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CONCATN) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	size_t stringByteCount = 0;
	for (int index = 0; index < c; ++index) {
		const Value value = REG(b + index);
		if (valueIsString(value)) {
			stringByteCount += m_stringPool.toString(asStringId(value)).size();
		}
	}
	std::string text;
	text.reserve(stringByteCount);
	for (int index = 0; index < c; ++index) {
		appendValueString(text, REG(b + index), m_stringPool);
	}
	const StringId textId = m_stringPool.internOwned(std::move(text));
	SET_REGISTER_FAST(a, valueString(textId));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(UNM) {
	const int a = decoded->a;
	const int b = decoded->b;
	const Value value = REG(b);
	SET_REGISTER_FAST(a, valueNumber(-asNumber(value)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(NOT) {
	const int a = decoded->a;
	const int b = decoded->b;
	SET_REGISTER_FAST(a, valueBool(!isTruthy(REG(b))));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LEN) {
	const int a = decoded->a;
	const int b = decoded->b;
	const Value& val = REG(b);
	if (valueIsString(val)) {
		int cp = static_cast<int>(m_stringPool.codepointCount(asStringId(val)));
		SET_REGISTER_FAST(a, valueNumber(static_cast<double>(cp)));
		DISPATCH_NEXT();
	}
	if (valueIsTable(val)) {
		SET_REGISTER_FAST(a, valueNumber(static_cast<double>(asTable(val)->length())));
		DISPATCH_NEXT();
	}
	throw LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
}

DISPATCH_LABEL(BNOT) {
	const int a = decoded->a;
	const int b = decoded->b;
	const Value value = REG(b);
	const uint32_t val = toU32(value);
	const int32_t result = static_cast<int32_t>(~val);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(EQ) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& left = readRK(IMAGE, registers, rkB);
	const Value& right = readRK(IMAGE, registers, rkC);
	bool eq = false;
	if (valueIsNumber(left) && valueIsNumber(right)) {
		eq = asNumber(left) == asNumber(right);
	} else {
		eq = left == right;
	}
	if (eq != (a != 0)) {
		SKIP_NEXT_INSTRUCTION();
		DISPATCH_CONTINUE();
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LT) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	bool ok = false;
	if (valueIsNumber(leftValue) && valueIsNumber(rightValue)) {
		ok = asNumber(leftValue) < asNumber(rightValue);
	} else if (valueIsString(leftValue) && valueIsString(rightValue)) {
		ok = m_stringPool.toString(asStringId(leftValue)) < m_stringPool.toString(asStringId(rightValue));
	}
	if (ok != (a != 0)) {
		SKIP_NEXT_INSTRUCTION();
		DISPATCH_CONTINUE();
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LE) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value& leftValue = readRK(IMAGE, registers, rkB);
	const Value& rightValue = readRK(IMAGE, registers, rkC);
	bool ok = false;
	if (valueIsNumber(leftValue) && valueIsNumber(rightValue)) {
		ok = asNumber(leftValue) <= asNumber(rightValue);
	} else if (valueIsString(leftValue) && valueIsString(rightValue)) {
		ok = m_stringPool.toString(asStringId(leftValue)) <= m_stringPool.toString(asStringId(rightValue));
	}
	if (ok != (a != 0)) {
		SKIP_NEXT_INSTRUCTION();
		DISPATCH_CONTINUE();
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MFC0) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (isUserMode()) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		DISPATCH_CONTINUE();
	}
	u32 value = 0u;
	switch (b) {
		case COP0_BAD_ADDRESS: value = m_badAddressWord; break;
		case COP0_LUA_FAULT_REASON: value = m_luaFaultReasonWord; break;
		case COP0_STATUS: value = m_statusWord; break;
		case COP0_CAUSE: value = m_causeWord; break;
		case COP0_EPC: value = m_epcWord; break;
		case COP0_EXEC: value = 0u; break;
		default: hardHalt(); DISPATCH_CONTINUE();
	}
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(value)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MTC0) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (isUserMode()) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		DISPATCH_CONTINUE();
	}
	const u32 value = toU32(REG(a));
	switch (b) {
		case COP0_STATUS: m_statusWord = value; break;
		case COP0_EPC: m_epcWord = value; break;
		case COP0_EXEC: executeFunctionAddress(value); DISPATCH_CONTINUE();
		case COP0_BAD_ADDRESS:
		case COP0_LUA_FAULT_REASON:
		case COP0_CAUSE:
			break;
		default: hardHalt(); break;
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(JMP) {
	const uint32_t bx = decoded->bx;
	FRAME.pc = bx;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(JMPIF) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	if (isTruthy(REG(a))) {
		FRAME.pc = bx;
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(JMPIFNOT) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx;
	if (!isTruthy(REG(a))) {
		FRAME.pc = bx;
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CLOSURE) {
	const int a = decoded->a;
	const int c = decoded->c;
	const uint32_t bx = decoded->bx;
	const u32 functionAddress = (c & CLOSURE_ADDRESS_REGISTER_FLAG) != 0
		? toU32(REG(bx))
		: bx * BLUA32_FUNCTION_ALIGNMENT;
	if (!readFunctionRecordOnBus(
		*m_activeExecutionImage,
		functionAddress,
		m_executionBusSignals
	)) {
		hardHalt();
		DISPATCH_CONTINUE();
	}
	Closure* closure = createClosure(FRAME);
	if (!closure) {
		DISPATCH_CONTINUE();
	}
	SET_REGISTER_FAST(a, valueClosure(closure));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETUP) {
	const int a = decoded->a;
	const int b = decoded->b;
	Upvalue* upvalue = FRAME.closure->upvalues[static_cast<size_t>(b)];
	SET_REGISTER_FAST(a, readUpvalue(upvalue));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETUP) {
	const int a = decoded->a;
	const int b = decoded->b;
	Upvalue* upvalue = FRAME.closure->upvalues[static_cast<size_t>(b)];
	writeUpvalue(upvalue, REG(a));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(VARARG) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int count = b == 0 ? FRAME.varargCount : b;
	if (count > 0) registers = ensureRegisterCapacity(FRAME, a + count - 1);
	const int copyCount = std::min(count, FRAME.varargCount);
	std::copy_n(m_activeThread->stack.data() + FRAME.varargBase, copyCount, registers + a);
	std::fill_n(registers + a + copyCount, count - copyCount, valueNil());
	const int nextTop = a + count;
	if (b == 0) {
		FRAME.top = nextTop;
	} else if (nextTop > FRAME.top) {
		FRAME.top = nextTop;
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CALL) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	int argCount = decodeCallArgCount(b, std::max(FRAME.top - a - 1, 0));
	int retCount = c;
	const Value& callee = REG(a);
	if (valueIsClosure(callee)) {
		Closure* closure = asClosure(callee);
		CallFrame* pushed = pushFrame(FRAME, closure, a + 1, argCount, a, retCount, false, FRAME.pc - INSTRUCTION_BYTES);
		if (pushed && m_functionRecordLatch.cacheableRead) {
			DISPATCH_REBIND_FRAME();
		}
		DISPATCH_CONTINUE();
	}
	if (valueIsBuiltinFunction(callee)) {
		runBuiltinFunction(*asBuiltinFunction(callee), FRAME, a, retCount, argCount);
		DISPATCH_CONTINUE();
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

DISPATCH_LABEL(RET) {
	const int a = decoded->a;
	const int b = decoded->b;
	int count = b == 0 ? std::max(FRAME.top - a, 0) : b;
	closeUpvalues(FRAME);
	if (m_activeThread->protectedCallDepth > 0) {
		const size_t continuationIndex = m_activeThread->protectedCallDepth - 1;
		ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
		if (continuation.target == &FRAME) {
			finishProtectedCall(continuationIndex, FRAME, a, count);
			auto finished = std::move(m_activeThread->frames.back());
			m_activeThread->frames.pop_back();
			m_activeThread->stackTop = finished->varargBase;
			releaseFrame(std::move(finished));
			DISPATCH_CONTINUE();
		}
	}
	if (FRAME.returnToCompletionLatch) {
		m_completionValues.assign(FRAME.registers + a, FRAME.registers + a + count);
		auto finished = std::move(m_activeThread->frames.back());
		m_activeThread->frames.pop_back();
		m_activeThread->stackTop = finished->varargBase;
		releaseFrame(std::move(finished));
		DISPATCH_CONTINUE();
	}
	if (m_activeThread->frames.size() == 1 && m_activeThread->resumer != nullptr) {
		Thread* thread = m_activeThread;
		thread->status = ThreadStatus::Dead;
		returnToResumer(FRAME.registers + a, count, true);
		auto finished = std::move(thread->frames.back());
		thread->frames.pop_back();
		thread->stackTop = 0;
		releaseFrame(std::move(finished));
		DISPATCH_CONTINUE();
	}
	if (m_activeThread->frames.size() == 1) {
		m_completionValues.assign(FRAME.registers + a, FRAME.registers + a + count);
	} else {
		CallFrame& caller = *m_activeThread->frames[m_activeThread->frames.size() - 2];
		writeReturnValuesFromRegisters(caller, FRAME.returnBase, FRAME.returnCount, FRAME, a, count);
	}
	auto finished = std::move(m_activeThread->frames.back());
	m_activeThread->frames.pop_back();
	m_activeThread->stackTop = finished->varargBase;
	releaseFrame(std::move(finished));
	DISPATCH_REBIND_FRAME();
}

DISPATCH_LABEL(LOAD_MEM_D) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const int disp = decoded->disp;
	const uint32_t addr = toU32(REG(b)) + (static_cast<uint32_t>(disp) << 2);
	if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(c)]) != 0u) {
		enterSynchronousAddressException(FRAME, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, addr);
		DISPATCH_CONTINUE();
	}
	const uint32_t faultSequence = m_memory.readBusFaultSequence();
	Value value;
	switch (static_cast<MemoryAccessKind>(c)) {
		case MemoryAccessKind::Word: value = valueNumber(static_cast<double>(m_memory.readMappedWord(addr))); break;
		case MemoryAccessKind::U8: value = valueNumber(static_cast<double>(m_memory.readMappedU8(addr))); break;
		case MemoryAccessKind::U16LE: value = valueNumber(static_cast<double>(m_memory.readMappedU16LE(addr))); break;
		case MemoryAccessKind::U32LE: value = valueNumber(static_cast<double>(m_memory.readMappedU32LE(addr))); break;
		case MemoryAccessKind::F32LE: value = valueNumber(static_cast<double>(m_memory.readMappedF32LE(addr))); break;
		case MemoryAccessKind::F64LE: value = valueNumber(m_memory.readMappedF64LE(addr)); break;
		default: __builtin_unreachable();
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_DATA_BUS_ERROR);
		DISPATCH_CONTINUE();
	}
	SET_REGISTER_FAST(a, value);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_D) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const int disp = decoded->disp;
	const uint32_t addr = toU32(REG(b)) + (static_cast<uint32_t>(disp) << 2);
	if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(c)]) != 0u) {
		enterSynchronousAddressException(FRAME, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
		DISPATCH_CONTINUE();
	}
	if (!m_memory.mappedWriteReady(addr)) {
		blockMappedWrite(FRAME, addr);
		DISPATCH_BLOCKED();
	}
	const Value value = REG(a);
	const uint32_t faultSequence = m_memory.readBusFaultSequence();
	switch (static_cast<MemoryAccessKind>(c)) {
		case MemoryAccessKind::Word: m_memory.writeMappedWord(addr, toU32(value)); break;
		case MemoryAccessKind::U8: m_memory.writeMappedU8(addr, static_cast<u8>(toU32(value))); break;
		case MemoryAccessKind::U16LE: m_memory.writeMappedU16LE(addr, toU32(value)); break;
		case MemoryAccessKind::U32LE: m_memory.writeMappedU32LE(addr, toU32(value)); break;
		case MemoryAccessKind::F32LE: m_memory.writeMappedF32LE(addr, static_cast<float>(decodeNumber(value))); break;
		case MemoryAccessKind::F64LE: m_memory.writeMappedF64LE(addr, decodeNumber(value)); break;
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS_D) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const int disp = decoded->disp;
	const uint32_t addr = toU32(REG(b)) + (static_cast<uint32_t>(disp) << 2);
	if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(MemoryAccessKind::Word)]) != 0u) {
		enterSynchronousAddressException(FRAME, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
		DISPATCH_CONTINUE();
	}
	const uint32_t blockedAddress = m_memory.firstBlockedMappedWordWrite(addr, c);
	if (blockedAddress != NO_BLOCKED_MAPPED_WRITE) {
		blockMappedWrite(FRAME, blockedAddress);
		DISPATCH_BLOCKED();
	}
	CYCLES_ADD(ceilDiv4(c));
	writeMappedWordSequence(FRAME, addr, a, c);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM) {
	const int a = decoded->a;
	const int c = decoded->c;
	const int rkB = decoded->b;
	const uint32_t addr = toU32(readRK(IMAGE, registers, rkB));
	if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(c)]) != 0u) {
		enterSynchronousAddressException(FRAME, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, addr);
		DISPATCH_CONTINUE();
	}
	const uint32_t faultSequence = m_memory.readBusFaultSequence();
	Value value;
	switch (static_cast<MemoryAccessKind>(c)) {
		case MemoryAccessKind::Word: value = valueNumber(static_cast<double>(m_memory.readMappedWord(addr))); break;
		case MemoryAccessKind::U8: value = valueNumber(static_cast<double>(m_memory.readMappedU8(addr))); break;
		case MemoryAccessKind::U16LE: value = valueNumber(static_cast<double>(m_memory.readMappedU16LE(addr))); break;
		case MemoryAccessKind::U32LE: value = valueNumber(static_cast<double>(m_memory.readMappedU32LE(addr))); break;
		case MemoryAccessKind::F32LE: value = valueNumber(static_cast<double>(m_memory.readMappedF32LE(addr))); break;
		case MemoryAccessKind::F64LE: value = valueNumber(m_memory.readMappedF64LE(addr)); break;
		default: __builtin_unreachable();
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_DATA_BUS_ERROR);
		DISPATCH_CONTINUE();
	}
	SET_REGISTER_FAST(a, value);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM) {
	const int a = decoded->a;
	const int c = decoded->c;
	const int rkB = decoded->b;
	const uint32_t addr = toU32(readRK(IMAGE, registers, rkB));
	if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(c)]) != 0u) {
		enterSynchronousAddressException(FRAME, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
		DISPATCH_CONTINUE();
	}
	if (!m_memory.mappedWriteReady(addr)) {
		blockMappedWrite(FRAME, addr);
		DISPATCH_BLOCKED();
	}
	const Value value = REG(a);
	const uint32_t faultSequence = m_memory.readBusFaultSequence();
	switch (static_cast<MemoryAccessKind>(c)) {
		case MemoryAccessKind::Word: m_memory.writeMappedWord(addr, toU32(value)); break;
		case MemoryAccessKind::U8: m_memory.writeMappedU8(addr, static_cast<u8>(toU32(value))); break;
		case MemoryAccessKind::U16LE: m_memory.writeMappedU16LE(addr, toU32(value)); break;
		case MemoryAccessKind::U32LE: m_memory.writeMappedU32LE(addr, toU32(value)); break;
		case MemoryAccessKind::F32LE: m_memory.writeMappedF32LE(addr, static_cast<float>(decodeNumber(value))); break;
		case MemoryAccessKind::F64LE: m_memory.writeMappedF64LE(addr, decodeNumber(value)); break;
	}
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS) {
	const int a = decoded->a;
	const int c = decoded->c;
	const int rkB = decoded->b;
	const uint32_t addr = toU32(readRK(IMAGE, registers, rkB));
	if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(MemoryAccessKind::Word)]) != 0u) {
		enterSynchronousAddressException(FRAME, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
		DISPATCH_CONTINUE();
	}
	const uint32_t blockedAddress = m_memory.firstBlockedMappedWordWrite(addr, c);
	if (blockedAddress != NO_BLOCKED_MAPPED_WRITE) {
		blockMappedWrite(FRAME, blockedAddress);
		DISPATCH_BLOCKED();
	}
	CYCLES_ADD(ceilDiv4(c));
	writeMappedWordSequence(FRAME, addr, a, c);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RFE) {
	if (isUserMode()) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		DISPATCH_CONTINUE();
	}
	if (!FRAME.isExceptionFrame) {
		hardHalt();
		DISPATCH_CONTINUE();
	}
	const bool returnFromNmi = FRAME.isNonMaskableExceptionFrame;
	const u32 returnPc = m_epcWord;
	closeUpvalues(FRAME);
	auto finished = std::move(m_activeThread->frames.back());
	m_activeThread->frames.pop_back();
	m_activeThread->stackTop = finished->varargBase;
	m_statusWord = (m_statusWord & ~CPU_STATUS_RFE_RESTORE_MASK)
		| ((m_statusWord >> 2u) & CPU_STATUS_RFE_RESTORE_MASK);
	if (!m_activeThread->frames.empty()) {
		m_activeThread->frames.back()->pc = returnPc;
	}
	if (returnFromNmi) {
		m_causeWord = m_nmiReturnCauseWord;
		m_epcWord = m_nmiReturnEpcWord;
		m_badAddressWord = m_nmiReturnBadAddressWord;
		m_luaFaultReasonWord = m_nmiReturnLuaFaultReasonWord;
		m_exceptionDomainWord = m_nmiReturnExceptionDomainWord;
	}
	releaseFrame(std::move(finished));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOADKR) {
	const int a = decoded->a;
	const int b = decoded->b;
	const u32 constantIndex = toU32(REG(b));
	if (constantIndex >= IMAGE.constPool.size()) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	SET_REGISTER_FAST(a, IMAGE.constPool[constantIndex]);
	DISPATCH_NEXT();
}
