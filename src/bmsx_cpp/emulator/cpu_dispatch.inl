DISPATCH_LABEL(WIDE) {
	throw BMSX_RUNTIME_ERROR("Unexpected WIDE opcode.");
}

DISPATCH_LABEL(MOV) {
	SET_REGISTER_FAST(a, REG(b));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOADK) {
	SET_REGISTER_FAST(a, m_program->constPool[static_cast<size_t>(bx)]);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOADNIL) {
	for (int i = 0; i < b; ++i) {
		SET_REGISTER_FAST(a + i, valueNil());
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOADBOOL) {
	SET_REGISTER_FAST(a, valueBool(b != 0));
	if (c != 0) {
		SKIP_NEXT_INSTRUCTION();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(KNIL) {
	SET_REGISTER_FAST(a, valueNil());
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(KFALSE) {
	SET_REGISTER_FAST(a, valueBool(false));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(KTRUE) {
	SET_REGISTER_FAST(a, valueBool(true));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(K0) {
	SET_REGISTER_FAST(a, valueNumber(0.0));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(K1) {
	SET_REGISTER_FAST(a, valueNumber(1.0));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(KM1) {
	SET_REGISTER_FAST(a, valueNumber(-1.0));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(KSMI) {
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(sbx)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETG) {
	const Value& key = m_program->constPool[static_cast<size_t>(bx)];
	SET_REGISTER_FAST(a, globals->get(key));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETG) {
	const Value& key = m_program->constPool[static_cast<size_t>(bx)];
	globals->set(key, REG(a));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETSYS) {
	SET_REGISTER_FAST(a, m_systemGlobalValues[static_cast<size_t>(bx)]);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETSYS) {
	m_systemGlobalValues[static_cast<size_t>(bx)] = REG(a);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETGL) {
	SET_REGISTER_FAST(a, m_globalValues[static_cast<size_t>(bx)]);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETGL) {
	m_globalValues[static_cast<size_t>(bx)] = REG(a);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETI) {
	SET_REGISTER_FAST(a, loadTableIntegerIndexCached(TABLE_CACHE_INDEX(), REG(b), c));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETI) {
	storeTableIntegerIndex(REG(a), b, readRK(FRAME, rkC));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETFIELD) {
	SET_REGISTER_FAST(a, loadTableFieldIndexCached(TABLE_CACHE_INDEX(), REG(b), asStringId(m_program->constPool[static_cast<size_t>(c)])));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETFIELD) {
	storeTableFieldIndex(REG(a), asStringId(m_program->constPool[static_cast<size_t>(b)]), readRK(FRAME, rkC));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SELF) {
	const Value base = REG(b);
	const StringId key = asStringId(m_program->constPool[static_cast<size_t>(c)]);
	SET_REGISTER_FAST(a + 1, base);
	SET_REGISTER_FAST(a, loadTableFieldIndexCached(TABLE_CACHE_INDEX(), base, key));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(HALT) {
	if (b != 0) {
		haltUntilVblank();
	} else {
		haltUntilIrq();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETT) {
	const Value& tableValue = REG(b);
	const Value& key = readRK(FRAME, rkC);
	SET_REGISTER_FAST(a, loadTableIndex(tableValue, key));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETT) {
	storeTableIndex(REG(a), readRK(FRAME, rkB), readRK(FRAME, rkC));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(NEWT) {
	auto* table = m_heap.allocate<Table>(ObjType::Table, b, c);
	SET_REGISTER_FAST(a, valueTable(table));
	runHousekeeping();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(ADD) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(left + right));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SUB) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(left - right));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MUL) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(left * right));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(DIV) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(left / right));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MOD) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(std::fmod(left, right)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(FLOORDIV) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(std::floor(left / right)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(POW) {
	double left = asNumber(readRK(FRAME, rkB));
	double right = asNumber(readRK(FRAME, rkC));
	SET_REGISTER_FAST(a, valueNumber(std::pow(left, right)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(BAND) {
	const uint32_t left = toU32(asNumber(readRK(FRAME, rkB)));
	const uint32_t right = toU32(asNumber(readRK(FRAME, rkC)));
	const int32_t result = static_cast<int32_t>(left & right);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(BOR) {
	const uint32_t left = toU32(asNumber(readRK(FRAME, rkB)));
	const uint32_t right = toU32(asNumber(readRK(FRAME, rkC)));
	const int32_t result = static_cast<int32_t>(left | right);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(BXOR) {
	const uint32_t left = toU32(asNumber(readRK(FRAME, rkB)));
	const uint32_t right = toU32(asNumber(readRK(FRAME, rkC)));
	const int32_t result = static_cast<int32_t>(left ^ right);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SHL) {
	const uint32_t left = toU32(asNumber(readRK(FRAME, rkB)));
	const uint32_t right = toU32(asNumber(readRK(FRAME, rkC))) & 31u;
	const uint32_t result = left << right;
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(static_cast<int32_t>(result))));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SHR) {
	const int32_t left = toI32(asNumber(readRK(FRAME, rkB)));
	const uint32_t right = toU32(asNumber(readRK(FRAME, rkC))) & 31u;
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(left >> right)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(CONCAT) {
	std::string text = valueToString(readRK(FRAME, rkB), m_stringPool);
	text += valueToString(readRK(FRAME, rkC), m_stringPool);
	const StringId textId = m_stringPool.intern(text);
	SET_REGISTER_FAST(a, valueString(textId));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(CONCATN) {
	std::string text;
	for (int index = 0; index < c; ++index) {
		text += valueToString(REG(b + index), m_stringPool);
	}
	const StringId textId = m_stringPool.intern(text);
	SET_REGISTER_FAST(a, valueString(textId));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(UNM) {
	double val = asNumber(REG(b));
	SET_REGISTER_FAST(a, valueNumber(-val));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(NOT) {
	SET_REGISTER_FAST(a, valueBool(!isTruthy(REG(b))));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LEN) {
	const Value& val = REG(b);
	if (valueIsString(val)) {
		int cp = static_cast<int>(m_stringPool.codepointCount(asStringId(val)));
		SET_REGISTER_FAST(a, valueNumber(static_cast<double>(cp)));
		DISPATCH_CONTINUE();
	}
	if (valueIsTable(val)) {
		SET_REGISTER_FAST(a, valueNumber(static_cast<double>(asTable(val)->length())));
		DISPATCH_CONTINUE();
	}
	if (valueIsNativeObject(val)) {
		auto* obj = asNativeObject(val);
		if (!obj->len) {
			std::string stack;
			auto callStack = getCallStack();
			for (auto it = callStack.rbegin(); it != callStack.rend(); ++it) {
				const auto& entry = *it;
				const auto range = getDebugRange(entry.second);
				if (!stack.empty()) {
					stack += " <- ";
				}
				if (range.has_value()) {
					stack += range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
				} else {
					stack += "<unknown>";
				}
			}
			throw BMSX_RUNTIME_ERROR("Length operator expects a native object with a length. stack=" + stack);
		}
		SET_REGISTER_FAST(a, valueNumber(static_cast<double>(obj->len())));
		DISPATCH_CONTINUE();
	}
	std::string stack;
	auto callStack = getCallStack();
	for (auto it = callStack.rbegin(); it != callStack.rend(); ++it) {
		const auto& entry = *it;
		const auto range = getDebugRange(entry.second);
		if (!stack.empty()) {
			stack += " <- ";
		}
		if (range.has_value()) {
			stack += range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
		} else {
			stack += "<unknown>";
		}
	}
	throw BMSX_RUNTIME_ERROR("Length operator expects a string or table. stack=" + stack);
}

DISPATCH_LABEL(BNOT) {
	const uint32_t val = toU32(asNumber(REG(b)));
	const int32_t result = static_cast<int32_t>(~val);
	SET_REGISTER_FAST(a, valueNumber(static_cast<double>(result)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(EQ) {
	const Value& left = readRK(FRAME, rkB);
	const Value& right = readRK(FRAME, rkC);
	bool eq = false;
	if (valueIsNumber(left) && valueIsNumber(right)) {
		eq = valueToNumber(left) == valueToNumber(right);
	} else if (valueIsTagged(left) && valueIsTagged(right)) {
		eq = left == right;
	}
	if (eq != (a != 0)) {
		SKIP_NEXT_INSTRUCTION();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LT) {
	const Value& leftValue = readRK(FRAME, rkB);
	const Value& rightValue = readRK(FRAME, rkC);
	bool ok = false;
	if (valueIsString(leftValue) && valueIsString(rightValue)) {
		ok = m_stringPool.toString(asStringId(leftValue)) < m_stringPool.toString(asStringId(rightValue));
	} else {
		auto toNumber = [this](const Value& value) -> double {
			if (valueIsNumber(value)) {
				return valueToNumber(value);
			}
			if (valueIsTagged(value)) {
				switch (valueTag(value)) {
					case ValueTag::False: return 0.0;
					case ValueTag::True: return 1.0;
					case ValueTag::Nil: return 0.0;
					case ValueTag::String: {
						const std::string& text = m_stringPool.toString(asStringId(value));
						char* end = nullptr;
						double parsed = std::strtod(text.c_str(), &end);
						if (end == text.c_str()) {
							return std::numeric_limits<double>::quiet_NaN();
						}
						return parsed;
					}
					default:
						return std::numeric_limits<double>::quiet_NaN();
				}
			}
			return std::numeric_limits<double>::quiet_NaN();
		};
		double left = toNumber(leftValue);
		double right = toNumber(rightValue);
		ok = left < right;
	}
	if (ok != (a != 0)) {
		SKIP_NEXT_INSTRUCTION();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LE) {
	const Value& leftValue = readRK(FRAME, rkB);
	const Value& rightValue = readRK(FRAME, rkC);
	bool ok = false;
	if (valueIsString(leftValue) && valueIsString(rightValue)) {
		ok = m_stringPool.toString(asStringId(leftValue)) <= m_stringPool.toString(asStringId(rightValue));
	} else {
		auto toNumber = [this](const Value& value) -> double {
			if (valueIsNumber(value)) {
				return valueToNumber(value);
			}
			if (valueIsTagged(value)) {
				switch (valueTag(value)) {
					case ValueTag::False: return 0.0;
					case ValueTag::True: return 1.0;
					case ValueTag::Nil: return 0.0;
					case ValueTag::String: {
						const std::string& text = m_stringPool.toString(asStringId(value));
						char* end = nullptr;
						double parsed = std::strtod(text.c_str(), &end);
						if (end == text.c_str()) {
							return std::numeric_limits<double>::quiet_NaN();
						}
						return parsed;
					}
					default:
						return std::numeric_limits<double>::quiet_NaN();
				}
			}
			return std::numeric_limits<double>::quiet_NaN();
		};
		double left = toNumber(leftValue);
		double right = toNumber(rightValue);
		ok = left <= right;
	}
	if (ok != (a != 0)) {
		SKIP_NEXT_INSTRUCTION();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(TEST) {
	const Value& val = REG(a);
	if (isTruthy(val) != (c != 0)) {
		SKIP_NEXT_INSTRUCTION();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(TESTSET) {
	const Value& val = REG(b);
	if (isTruthy(val) == (c != 0)) {
		SET_REGISTER_FAST(a, val);
	} else {
		SKIP_NEXT_INSTRUCTION();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(JMP) {
	FRAME.pc += sbx * INSTRUCTION_BYTES;
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(JMPIF) {
	if (isTruthy(REG(a))) {
		FRAME.pc += sbx * INSTRUCTION_BYTES;
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(JMPIFNOT) {
	if (!isTruthy(REG(a))) {
		FRAME.pc += sbx * INSTRUCTION_BYTES;
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(BR_TRUE) {
	if (isTruthy(REG(a))) {
		FRAME.pc += sbx * INSTRUCTION_BYTES;
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(BR_FALSE) {
	if (!isTruthy(REG(a))) {
		FRAME.pc += sbx * INSTRUCTION_BYTES;
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(CLOSURE) {
	Closure* closure = createClosure(FRAME, static_cast<int>(bx));
	SET_REGISTER_FAST(a, valueClosure(closure));
	runHousekeeping();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETUP) {
	Upvalue* upvalue = FRAME.closure->upvalues[static_cast<size_t>(b)];
	SET_REGISTER_FAST(a, readUpvalue(upvalue));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(SETUP) {
	Upvalue* upvalue = FRAME.closure->upvalues[static_cast<size_t>(b)];
	writeUpvalue(upvalue, REG(a));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(VARARG) {
	int count = b == 0 ? FRAME.varargCount : b;
	for (int i = 0; i < count; ++i) {
		Value value = i < FRAME.varargCount ? m_stack[static_cast<size_t>(FRAME.varargBase + i)] : valueNil();
		SET_REGISTER_FAST(a + i, value);
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(CALL) {
	int argCount = b == 0 ? std::max(FRAME.top - a - 1, 0) : b;
	int retCount = c;
	const Value& callee = REG(a);
	if (valueIsClosure(callee)) {
		Closure* closure = asClosure(callee);
		pushFrame(FRAME, closure, a + 1, argCount, a, retCount, false, FRAME.pc - INSTRUCTION_BYTES);
		DISPATCH_CONTINUE();
	}
	if (valueIsNativeFunction(callee)) {
		NativeFunction* fn = asNativeFunction(callee);
		CYCLES_ADD(static_cast<int>(fn->cycleBase));
		const NativeArgsView args(FRAME.registers + static_cast<size_t>(a + 1), static_cast<size_t>(argCount));
		NativeResults out = acquireNativeReturnScratch();
		fn->invoke(args, out);
		if (!m_frames.empty() && m_frames.back().get() == &FRAME) {
			writeReturnValues(FRAME, a, retCount, out.data(), static_cast<int>(out.size()));
		}
		runHousekeeping();
		releaseNativeReturnScratch(std::move(out));
		DISPATCH_CONTINUE();
	}
	throw BMSX_RUNTIME_ERROR(formatNonFunctionCallError(
		callee,
		m_stringPool,
		getDebugRange(FRAME.pc - INSTRUCTION_BYTES)
	));
}

DISPATCH_LABEL(RET) {
	int count = b == 0 ? std::max(FRAME.top - a, 0) : b;
	const Value* results = FRAME.registers + a;
	closeUpvalues(FRAME);
	auto finished = std::move(m_frames.back());
	m_frames.pop_back();
	if (finished->captureReturns) {
		if (m_externalReturnSink) {
			m_externalReturnSink->clear();
			m_externalReturnSink->append(results, static_cast<size_t>(count));
		} else {
			captureLastReturnValues(results, count);
		}
		m_stackTop = finished->varargBase;
		m_stack.resize(static_cast<size_t>(m_stackTop));
		releaseFrame(std::move(finished));
		DISPATCH_CONTINUE();
	}
	if (m_frames.empty()) {
		if (m_externalReturnSink) {
			m_externalReturnSink->clear();
			m_externalReturnSink->append(results, static_cast<size_t>(count));
		} else {
			captureLastReturnValues(results, count);
		}
		m_stackTop = finished->varargBase;
		m_stack.resize(static_cast<size_t>(m_stackTop));
		releaseFrame(std::move(finished));
		DISPATCH_CONTINUE();
	}
	CallFrame& caller = *m_frames.back();
	const int writeCount = finished->returnCount == 0 ? count : finished->returnCount;
	if (writeCount > 0) {
		ensureRegisterCapacity(caller, finished->returnBase + writeCount - 1);
		results = finished->registers + a;
	}
	writeReturnValues(caller, finished->returnBase, finished->returnCount, results, count);
	m_stackTop = finished->varargBase;
	m_stack.resize(static_cast<size_t>(m_stackTop));
	releaseFrame(std::move(finished));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM) {
	const uint32_t addr = static_cast<uint32_t>(asNumber(readRK(FRAME, rkB)));
	SET_REGISTER_FAST(a, readMappedMemoryValue(addr, static_cast<MemoryAccessKind>(c)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM) {
	const uint32_t addr = static_cast<uint32_t>(asNumber(readRK(FRAME, rkB)));
	writeMappedMemoryValue(addr, static_cast<MemoryAccessKind>(c), REG(a));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS) {
	const uint32_t addr = static_cast<uint32_t>(asNumber(readRK(FRAME, rkB)));
	CYCLES_ADD(ceilDiv4(c));
	writeMappedWordSequence(FRAME, addr, a, c);
	DISPATCH_CONTINUE();
}
