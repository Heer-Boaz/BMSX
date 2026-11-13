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
		instructionBudgetRemaining -= b;
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
		if (table->getIntegerArrayKey(c, value)) {
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
		if (table->getNumberArrayKey(asNumber(key), value)) {
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
	CYCLES_ADD(2 * static_cast<int>(table->storedSlotCount()) - b);
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
	executeConcat(FRAME, decoded->a, decoded->b, decoded->c);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CONCATN) {
	executeConcatRange(FRAME, decoded->a, decoded->b, decoded->c);
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
		SET_REGISTER_FAST(a, valueNumber(Table::length(asTable(val))));
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
	const bool eq = valuesEqual(left, right);
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
		ok = compareStringIds(&m_stringPool, asStringId(leftValue), asStringId(rightValue), &instructionBudgetRemaining) < 0;
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
		ok = compareStringIds(&m_stringPool, asStringId(leftValue), asStringId(rightValue), &instructionBudgetRemaining) <= 0;
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
	if (!cop0FieldImplemented(b)) { hardHalt(); DISPATCH_CONTINUE(); }
	const u32 value = b == COP0_EXEC ? 0u : m_cop0Words[b];
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
		case COP0_STATUS: m_cop0Words[COP0_STATUS] = value; break;
		case COP0_EPC: m_cop0Words[COP0_EPC] = value; break;
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
	executeClosure(FRAME, decoded->a, decoded->bx, decoded->c);
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
	executeVararg(FRAME, decoded->a, decoded->b);
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CALL) {
	if (executeCall(FRAME, decoded->a, decoded->b, decoded->c)) {
		DISPATCH_REBIND_FRAME();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RET) {
	if (executeReturn(FRAME, decoded->a, decoded->b)) {
		DISPATCH_REBIND_FRAME();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM_D) {
	const u32 address = toU32(REG(decoded->b)) + (static_cast<u32>(decoded->disp) << 2u);
	executeMemoryLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_D) {
	const u32 address = toU32(REG(decoded->b)) + (static_cast<u32>(decoded->disp) << 2u);
	if (!executeMemoryStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS_D) {
	const u32 address = toU32(REG(decoded->b)) + (static_cast<u32>(decoded->disp) << 2u);
	if (!executeWordStores(FRAME, address, decoded->a, decoded->c)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM) {
	const u32 address = toU32(readRK(IMAGE, registers, decoded->b));
	executeMemoryLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM) {
	const u32 address = toU32(readRK(IMAGE, registers, decoded->b));
	if (!executeMemoryStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS) {
	const u32 address = toU32(readRK(IMAGE, registers, decoded->b));
	if (!executeWordStores(FRAME, address, decoded->a, decoded->c)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RFE) {
	returnFromException(FRAME);
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
