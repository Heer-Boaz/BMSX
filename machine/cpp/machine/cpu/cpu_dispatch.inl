case static_cast<u8>(DecodedDispatchOp::InvalidImageOperand):
	throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);

DISPATCH_LABEL(WIDE) {
	hardHalt();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MOV) {
	const int a = decoded->a;
	const int b = decoded->b;
	const auto kind = static_cast<ValueMoveKind>(decoded->c);
	if (kind == ValueMoveKind::Copy) { SET_REGISTER_FAST(a, REG(b)); }
	else if (kind == ValueMoveKind::FloatBits || kind == ValueMoveKind::FloatFromBits) {
		const Value value = REG(b);
		const ValueTag source = kind == ValueMoveKind::FloatBits ? ValueTag::Float : ValueTag::Integer;
		if (valueTag(value) != source) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		SET_REGISTER_FAST(a, valueFromTag(kind == ValueMoveKind::FloatBits ? ValueTag::Integer : ValueTag::Float, valuePayload(value)));
	} else {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		DISPATCH_CONTINUE();
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LOADK) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	SET_REGISTER_FAST(a, IMAGE.constPool.get(static_cast<size_t>(bx)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LOADNIL) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (b != 0) {
		registers.clear(a, b);
		instructionBudgetRemaining -= b;
		const int nextTop = a + b;
		if (nextTop > FRAME.readWindow(FrameField::Top)) {
			FRAME.setTop(nextTop);
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
	SET_REGISTER_FAST(a, valueInteger(0));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(K1) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueInteger(1));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KM1) {
	const int a = decoded->a;
	SET_REGISTER_FAST(a, valueInteger(-1));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(KSMI) {
	const int a = decoded->a;
	const int sbx = decoded->sbx();
	SET_REGISTER_FAST(a, valueInteger(sbx));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETSYS) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	SET_REGISTER_FAST(a, m_systemGlobalBank.readSlot(bx));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETSYS) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	m_systemGlobalBank.writeSlot(bx, REG(a));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETGL) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	SET_REGISTER_FAST(a, m_globalBank.readSlot(bx));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETGL) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	m_globalBank.writeSlot(bx, REG(a));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETI) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const Value tableValue = REG(b);
	if (valueIsTable(tableValue)) {
		const TableRecord table(m_heap, valuePayload(tableValue));
		Value value;
		if (table.getIntegerArrayKey(c, value)) {
			SET_REGISTER_FAST(a, value);
			DISPATCH_NEXT();
		}
	}
	if (loadTableIntegerIndex(FRAME, a, tableValue, c)) DISPATCH_CONTINUE();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETI) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	const Value tableValue = REG(a);
	const Value& value = readRK(IMAGE, registers, rkC);
	if (valueIsTable(tableValue)
		&& TableRecord(m_heap, valuePayload(tableValue)).tryAssignIntegerArrayKey(b, value)) {
		DISPATCH_NEXT();
	}
	if (storeTableIntegerIndex(FRAME, tableValue, b, value)) DISPATCH_CONTINUE();
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETFIELD) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	if (loadTableFieldIndexCached(FRAME, a,
		TABLE_CACHE_SLOT(),
		REG(b),
		asStringId(IMAGE.constPool.get(static_cast<size_t>(c)))
	)) DISPATCH_CONTINUE();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETFIELD) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.setfield;
#endif
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	if (storeTableFieldIndexCached(FRAME,
		TABLE_CACHE_SLOT(),
		REG(a),
		asStringId(IMAGE.constPool.get(static_cast<size_t>(b))),
		readRK(IMAGE, registers, rkC)
	)) DISPATCH_CONTINUE();
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SELF) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	const Value base = REG(b);
	const StringId key = asStringId(IMAGE.constPool.get(static_cast<size_t>(c)));
	SET_REGISTER_FAST(a + 1, base);
	if (loadTableFieldIndexCached(FRAME, a, TABLE_CACHE_SLOT(), base, key)) DISPATCH_CONTINUE();
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
	const Value tableValue = REG(b);
	const Value& key = readRK(IMAGE, registers, rkC);
	if (valueIsTable(tableValue) && valueIsInteger(key)) {
		const TableRecord table(m_heap, valuePayload(tableValue));
		Value value;
		if (table.getIntegerArrayKey(asInteger(key), value)) {
			SET_REGISTER_FAST(a, value);
			DISPATCH_NEXT();
		}
	}
	if (loadTableIndex(FRAME, a, tableValue, key)) DISPATCH_CONTINUE();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETT) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value tableValue = REG(a);
	const Value& key = readRK(IMAGE, registers, rkB);
	const Value& value = readRK(IMAGE, registers, rkC);
	if (valueIsTable(tableValue)
		&& valueIsInteger(key)
		&& TableRecord(m_heap, valuePayload(tableValue)).tryAssignIntegerArrayKey(asInteger(key), value)) {
		DISPATCH_NEXT();
	}
	if (storeTableIndex(FRAME, tableValue, key, value)) DISPATCH_CONTINUE();
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(NEWT) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.newt;
#endif
	const int a = decoded->a;
	const int b = decoded->b;
	const int c = decoded->c;
	auto table = createTable(b, c);
	registers = FRAME.registers;
	CYCLES_ADD(2 * static_cast<int>(table.storedSlotCount()) - b);
	SET_REGISTER_FAST(a, valueTable(table.address()));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(ADD) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	const Value result = valueAdd(left, right);
	SET_REGISTER_FAST(decoded->a, result);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	observeScalarArithmetic(left, right);
#endif
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SUB) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	const Value result = valueSubtract(left, right);
	SET_REGISTER_FAST(decoded->a, result);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	observeScalarArithmetic(left, right);
#endif
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MUL) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	const Value result = valueMultiply(left, right);
	SET_REGISTER_FAST(decoded->a, result);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	observeScalarArithmetic(left, right);
#endif
	DISPATCH_NEXT();
}

DISPATCH_LABEL(DIV) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valueDivide(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MOD) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valueModulo(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(FLOORDIV) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valueFloorDivide(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(POW) {
	const Value left = readRK(IMAGE, registers, decoded->b);
	const Value right = readRK(IMAGE, registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valuePower(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BAND) {
	const i32 left = integerOperand(readRK(IMAGE, registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(left & right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BOR) {
	const i32 left = integerOperand(readRK(IMAGE, registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(left | right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BXOR) {
	const i32 left = integerOperand(readRK(IMAGE, registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(left ^ right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SHL) {
	const i32 left = integerOperand(readRK(IMAGE, registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(luaShiftLeft(left, right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SHR) {
	const i32 left = integerOperand(readRK(IMAGE, registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(luaShiftRight(left, right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CONCAT) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.concat;
#endif
	executeConcat(FRAME, decoded->a, decoded->b, decoded->c);
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CONCATN) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.concatn;
#endif
	executeConcatRange(FRAME, decoded->a, decoded->b, decoded->c);
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(UNM) {
	const int a = decoded->a;
	const int b = decoded->b;
	const Value value = REG(b);
	SET_REGISTER_FAST(a, valueNegate(value));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(NOT) {
	const int a = decoded->a;
	const int b = decoded->b;
	SET_REGISTER_FAST(a, valueBool(!isTruthy(REG(b))));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(LEN) {
	if (executeLength(FRAME, decoded->a, REG(decoded->b))) DISPATCH_CONTINUE();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BNOT) {
	const int a = decoded->a;
	const int b = decoded->b;
	const Value value = REG(b);
	const uint32_t val = integerOperand(value);
	const int32_t result = static_cast<int32_t>(~val);
	SET_REGISTER_FAST(a, valueInteger(result));
	DISPATCH_NEXT();
}

#define DISPATCH_COMPARISON(name) \
	DISPATCH_LABEL(name) { \
		const Value operands[]{readRK(IMAGE, registers, decoded->b), readRK(IMAGE, registers, decoded->c)}; \
		if (testValueComparison<OpCode::name>(operands, m_stringPool, instructionBudgetRemaining) != (decoded->a != 0)) { \
			SKIP_NEXT_INSTRUCTION(); \
			DISPATCH_CONTINUE(); \
		} \
		DISPATCH_NEXT(); \
	}

DISPATCH_COMPARISON(EQ)
DISPATCH_COMPARISON(LT)
DISPATCH_COMPARISON(LE)

#undef DISPATCH_COMPARISON

DISPATCH_LABEL(MFC0) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (isUserMode()) {
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		DISPATCH_CONTINUE();
	}
	if (!cop0FieldImplemented(b)) { hardHalt(); DISPATCH_CONTINUE(); }
	const u32 value = b == COP0_EXEC ? 0u : m_cop0Words[b];
	SET_REGISTER_FAST(a, valueInteger(static_cast<i32>(value)));
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MTC0) {
	executeControlWrite(FRAME,decoded->a,decoded->b);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(JMP) {
	if (decoded->a != 0) instructionBudgetRemaining -= closeUpvalues(FRAME, static_cast<u32>(FRAME.stackBase()) + decoded->a - 1u);
	const uint32_t bx = decoded->bx();
	FRAME.writeControl(FrameField::Pc, bx);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(JMPIF) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	if (isTruthy(REG(a))) {
		FRAME.writeControl(FrameField::Pc, bx);
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(JMPIFNOT) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	if (!isTruthy(REG(a))) {
		FRAME.writeControl(FrameField::Pc, bx);
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CLOSURE) {
	executeClosure(FRAME, decoded->a, decoded->bx(), decoded->c);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETUP) {
	const int a = decoded->a;
	const int b = decoded->b;
	const u32 address = FRAME.captureAddress(static_cast<u32>(b));
	SET_REGISTER_FAST(a, Upvalue::load(m_memory, address));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETUP) {
	const int a = decoded->a;
	const int b = decoded->b;
	const u32 address = FRAME.captureAddress(static_cast<u32>(b));
	Upvalue::store(m_heap, address, REG(a));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(VARARG) {
	executeVararg(FRAME, decoded->a, decodeValueCount(decoded->b, -1));
	registers = FRAME.registers;
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CALL) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.call;
#endif
	if (executeCall(FRAME, decoded->a, decodeValueCount(decoded->b, -1), decodeValueCount(decoded->c, -1))) {
		DISPATCH_REBIND_FRAME();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RET) {
	if (executeReturn(FRAME, decoded->a, decodeValueCount(decoded->b, -1))) {
		DISPATCH_REBIND_FRAME();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM_D) {
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(REG(decoded->b)) + (static_cast<u32>(decoded->disp) << 2u);
	executeMemoryLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_D) {
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(REG(decoded->b)) + (static_cast<u32>(decoded->disp) << 2u);
	if (!executeMemoryStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS_D) {
	const u32 address = wordOperand(REG(decoded->b)) + (static_cast<u32>(decoded->disp) << 2u);
	if (!executeWordStores(FRAME, address, decoded->a, decoded->c)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM) {
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(readRK(IMAGE, registers, decoded->b));
	executeMemoryLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM) {
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(readRK(IMAGE, registers, decoded->b));
	if (!executeMemoryStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS) {
	const u32 address = wordOperand(readRK(IMAGE, registers, decoded->b));
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
	const u32 constantIndex = wordOperand(REG(b));
	if (constantIndex >= IMAGE.constPool.size()) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	SET_REGISTER_FAST(a, IMAGE.constPool.get(constantIndex));
	DISPATCH_NEXT();
}
