DISPATCH_INTERNAL(InvalidImageOperand)
	throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);

DISPATCH_LABEL(WIDE) {
	PUBLISH_SCALAR_FRONTIER();
	hardHalt();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MOV) {
	const int a = decoded->a;
	const int b = decoded->b;
	const auto kind = static_cast<ValueMoveKind>(decoded->c);
	if (kind == ValueMoveKind::Copy) { SET_REGISTER_FAST(a, REG(b)); }
	else if (kind == ValueMoveKind::Tag) { SET_REGISTER_FAST(a, valueInteger(static_cast<u8>(FRAME.registers.tag(b)))); }
	else if (kind == ValueMoveKind::FloatBits || kind == ValueMoveKind::FloatFromBits) {
		const Value value = REG(b);
		const ValueTag source = kind == ValueMoveKind::FloatBits ? ValueTag::Float : ValueTag::Integer;
		if (valueTag(value) != source) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		SET_REGISTER_FAST(a, valueFromTag(kind == ValueMoveKind::FloatBits ? ValueTag::Integer : ValueTag::Float, valuePayload(value)));
	} else {
		PUBLISH_SCALAR_FRONTIER();
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
		FRAME.registers.clear(a, b);
		instructionBudgetRemaining -= b;
		EXTEND_TOP(a + b);
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

DISPATCH_LABEL(ITERN) {
	if (stepTableIterator(FRAME.registers, decoded->a, decoded->b, decoded->c)) {
		CYCLES_ADD(decoded->c);
		EXTEND_TOP(decoded->b + decoded->c);
		DISPATCH_SKIP_NEXT();
	}
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
	SET_REGISTER_FAST(a, m_systemGlobalBank.values().get(bx));
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
	SET_REGISTER_FAST(a, m_globalBank.values().get(bx));
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
	PUBLISH_SCALAR_FRONTIER();
	if (loadTableIntegerIndex(FRAME, a, tableValue, c)) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETI) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	const Value tableValue = REG(a);
	const Value& value = readRK(IMAGE, FRAME.registers, rkC);
	if (valueIsTable(tableValue)
		&& TableRecord(m_heap, valuePayload(tableValue)).tryAssignIntegerArrayKey(b, value)) {
		DISPATCH_NEXT();
	}
	PUBLISH_SCALAR_FRONTIER();
	if (storeTableIntegerIndex(FRAME, tableValue, b, value)) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(GETFIELD)
DISPATCH_LABEL(SELF) {
	const int a = decoded->a;
	const Value base = REG(decoded->b);
	const StringId key = asStringId(IMAGE.constPool.get(static_cast<size_t>(decoded->c)));
	if (decoded->op == static_cast<u8>(OpCode::SELF)) SET_REGISTER_FAST(a + 1, base);
	const TableRecord table(m_heap, tableIndexAddress(base));
	int& predicted = TABLE_CACHE_SLOT();
	u32 links = 0;
	if (const auto own = table.readOwnStringField(key, predicted, &links)) {
		CYCLES_ADD(static_cast<int>(links));
		SET_REGISTER_FAST(a, *own);
		DISPATCH_NEXT();
	}
	TableLookupResult result;
	links += table.resolveMissingStringIndex(key, result);
	CYCLES_ADD(static_cast<int>(links));
	if (result.status == TableLookupStatus::Resolved) {
		CYCLES_ADD(static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES);
		SET_REGISTER_FAST(a, result.value);
		DISPATCH_NEXT();
	}
	PUBLISH_SCALAR_FRONTIER();
	if (finishTableRead(FRAME, a, base, valueString(key), result)) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETFIELD) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.setfield;
#endif
	const Value base = REG(decoded->a);
	const StringId key = asStringId(IMAGE.constPool.get(static_cast<size_t>(decoded->b)));
	const Value value = readRK(IMAGE, FRAME.registers, decoded->c);
	int& predicted = TABLE_CACHE_SLOT();
	// An own overwrite and its write barrier do not observe the frame.
	const bool isTable = valueIsTable(base);
	const u8 extraHashSlots = instructionFieldExtraHashSlots(decodedPage->sourceWords[pageOffset], decoded->width);
	if (isTable) {
		TableRecord table(m_heap, valuePayload(base));
		if constexpr (!Instrumented) {
			const int slot = table.tryAssignCachedStringField(key, value, predicted);
			if (slot != TableRecord::HASH_STORE_DECLINED) {
				predicted = slot;
				DISPATCH_NEXT();
			}
		} else if (table.storePredictedStringKey(key, value, predicted)) {
			DISPATCH_NEXT();
		}
	}
	PUBLISH_SCALAR_FRONTIER();
	if (storeTableFieldIndexCached(FRAME, predicted, base, key, value, extraHashSlots)) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(HALT) {
	PUBLISH_SCALAR_FRONTIER();
	haltUntilIrq();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETT) {
	const int a = decoded->a;
	const int b = decoded->b;
	const int rkC = decoded->c;
	const Value tableValue = REG(b);
	const Value& key = readRK(IMAGE, FRAME.registers, rkC);
	if (valueIsTable(tableValue) && valueIsInteger(key)) {
		const TableRecord table(m_heap, valuePayload(tableValue));
		Value value;
		if (table.getIntegerArrayKey(asInteger(key), value)) {
			SET_REGISTER_FAST(a, value);
			DISPATCH_NEXT();
		}
	}
	PUBLISH_SCALAR_FRONTIER();
	if (loadTableIndex(FRAME, a, tableValue, key)) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETT) {
	const int a = decoded->a;
	const int rkB = decoded->b;
	const int rkC = decoded->c;
	const Value tableValue = REG(a);
	const Value& key = readRK(IMAGE, FRAME.registers, rkB);
	const Value& value = readRK(IMAGE, FRAME.registers, rkC);
	if (valueIsTable(tableValue)
		&& valueIsInteger(key)
		&& TableRecord(m_heap, valuePayload(tableValue)).tryAssignIntegerArrayKey(asInteger(key), value)) {
		DISPATCH_NEXT();
	}
	PUBLISH_SCALAR_FRONTIER();
	if (storeTableIndex(FRAME, tableValue, key, value)) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(ARGC) {
	SET_REGISTER_FAST(decoded->a, valueInteger(static_cast<i32>(FRAME.readControl(FrameField::ArgumentCount))));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SVC) {
	PUBLISH_SCALAR_FRONTIER();
	executeSupervisorCall(FRAME, decoded->a, decoded->b);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RESERVED_10) {
	PUBLISH_SCALAR_FRONTIER();
	enterSynchronousException(FRAME, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(ADD) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	const Value result = valueAdd(left, right);
	SET_REGISTER_FAST(decoded->a, result);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	OBSERVE_SCALAR_ARITHMETIC(left, right);
#endif
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SUB) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	const Value result = valueSubtract(left, right);
	SET_REGISTER_FAST(decoded->a, result);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	OBSERVE_SCALAR_ARITHMETIC(left, right);
#endif
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MUL) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	const Value result = valueMultiply(left, right);
	SET_REGISTER_FAST(decoded->a, result);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	OBSERVE_SCALAR_ARITHMETIC(left, right);
#endif
	DISPATCH_NEXT();
}

DISPATCH_LABEL(DIV) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valueDivide(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(MOD) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valueModulo(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(FLOORDIV) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valueFloorDivide(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(POW) {
	const Value left = readRK(IMAGE, FRAME.registers, decoded->b);
	const Value right = readRK(IMAGE, FRAME.registers, decoded->c);
	SET_REGISTER_FAST(decoded->a, valuePower(left, right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BAND) {
	const i32 left = integerOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, FRAME.registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(left & right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BOR) {
	const i32 left = integerOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, FRAME.registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(left | right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(BXOR) {
	const i32 left = integerOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, FRAME.registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(left ^ right));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SHL) {
	const i32 left = integerOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, FRAME.registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(luaShiftLeft(left, right)));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SHR) {
	const i32 left = integerOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	const i32 right = integerOperand(readRK(IMAGE, FRAME.registers, decoded->c));
	SET_REGISTER_FAST(decoded->a, valueInteger(luaShiftRight(left, right)));
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
	PUBLISH_SCALAR_FRONTIER();
	if (executeLength(FRAME, decoded->a, REG(decoded->b))) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
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
		const Value operands[]{readRK(IMAGE, FRAME.registers, decoded->b), readRK(IMAGE, FRAME.registers, decoded->c)}; \
		const auto predicate = testValueComparison<OpCode::name>(operands, m_stringPool, instructionBudgetRemaining); \
		if constexpr (OpCode::name != OpCode::EQ) { \
			if (predicate == LONG_STRING_COMPARISON) { \
				PUBLISH_SCALAR_FRONTIER(); \
				beginStringComparison(FRAME, asStringId(operands[0]), asStringId(operands[1]), OpCode::name == OpCode::LE, decoded->a != 0); \
				DISPATCH_CONTINUE(); \
			} \
		} \
		if (predicate != (decoded->a != 0)) { \
			DISPATCH_SKIP_NEXT(); \
		} \
		COMPARISON_FALLTHROUGH(); \
		DISPATCH_NEXT(); \
	}

DISPATCH_COMPARISON(EQ)
DISPATCH_COMPARISON(LT)
DISPATCH_COMPARISON(LE)

#undef DISPATCH_COMPARISON

DISPATCH_LABEL(MFC0) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (b != COP0_EVENT_CYCLES && isUserMode()) {
		PUBLISH_SCALAR_FRONTIER();
		enterSynchronousException(FRAME, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		DISPATCH_CONTINUE();
	}
	if (!cop0FieldImplemented(b)) { PUBLISH_SCALAR_FRONTIER(); hardHalt(); DISPATCH_CONTINUE(); }
	if (static_cast<size_t>(a) >= FRAME.registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 value = b == COP0_EVENT_CYCLES ? static_cast<u32>(remainingDeviceCycles())
		: b == COP0_RAM_END ? m_memory.ramBusEnd()
		: b == COP0_CURRENT ? FRAME.thread->address : cop0ReadAsZero(b) ? 0u : m_cop0Words[b];
	SET_REGISTER_FAST(a, valueInteger(static_cast<i32>(value)));
	PUBLISH_SCALAR_FRONTIER();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(MTC0) {
	PUBLISH_SCALAR_FRONTIER();
	executeControlWrite(FRAME,decoded->a,decoded->b);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(JMP) {
	if (decoded->a != 0) instructionBudgetRemaining -= closeUpvalues(FRAME, static_cast<u32>(FRAME.stackBase()) + decoded->a - 1u);
	const uint32_t bx = decoded->bx();
	SET_NEXT_PC(bx);
	DISPATCH_NEXT();
}

DISPATCH_LABEL(JMPIF) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	if (isTruthy(REG(a))) {
		SET_NEXT_PC(bx);
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(JMPIFNOT) {
	const int a = decoded->a;
	const uint32_t bx = decoded->bx();
	if (!isTruthy(REG(a))) {
		SET_NEXT_PC(bx);
	}
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CLOSURE) {
	if constexpr (HeapService) {
		// Link-verified static edges carry the immutable ROM record, never
		// an ordinary language Closure. The CALL context owns this word.
		SET_REGISTER_FAST(decoded->a, valueInteger(static_cast<i32>(decoded->bx() * BLUA32_FUNCTION_ALIGNMENT)));
		DISPATCH_NEXT();
	}
	PUBLISH_SCALAR_FRONTIER();
	executeClosure(FRAME, decoded->a, decoded->bx(), decoded->c);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(GETUP) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (static_cast<u32>(b) >= FRAME.captureCount()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 address = FRAME.captureAddress(static_cast<u32>(b));
	SET_REGISTER_FAST(a, Upvalue::load(m_memory, address));
	DISPATCH_NEXT();
}

DISPATCH_LABEL(SETUP) {
	const int a = decoded->a;
	const int b = decoded->b;
	if (static_cast<u32>(b) >= FRAME.captureCount()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 cell = FRAME.captureAddress(static_cast<u32>(b)) & UPVALUE_ADDRESS_MASK;
	const Value value = REG(a);
	if (Upvalue::tryStoreDirect(m_memory, cell, value)) DISPATCH_NEXT();
	PUBLISH_SCALAR_FRONTIER();
	enterClosedUpvalueStore(FRAME, cell, value);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(VARARG) {
	PUBLISH_SCALAR_FRONTIER();
	if (executeVararg(FRAME, decoded->a, decodeValueCount(decoded->b, -1))) DISPATCH_CONTINUE();
	RESUME_SCALAR_FRONTIER();
	DISPATCH_NEXT();
}

DISPATCH_LABEL(CALL) {
	if constexpr (HeapService) {
		PUBLISH_SCALAR_FRONTIER();
		executeHeapServiceCall(FRAME, decoded->a, decodeValueCount(decoded->b, -1), decodeValueCount(decoded->c, -1));
		DISPATCH_REBIND_FRAME();
	}
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	++m_diagnosticExecutionProfile.interpreterOpcodes.call;
#endif
	PUBLISH_SCALAR_FRONTIER();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if constexpr (!Instrumented) {
		if (decoded->b != 0 && decoded->nativeCallTarget() == DecodedInstruction::CALL_TARGET_UNSEEN
			&& decodedPage->mapping.cacheable && !decodedPage->mapping.writeWatch.groups
			&& Blua32RomFunctionDirectory::ownsAddress(FRAME.executionImage->executionDomainId, pc))
			observeNativeCallTarget(FRAME, *decodedPage, pc);
	}
#endif
	if (executeCall(FRAME, decoded->a, decodeValueCount(decoded->b, -1), decodeValueCount(decoded->c, -1))) {
		DISPATCH_REBIND_FRAME();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RET) {
	PUBLISH_SCALAR_FRONTIER();
	const bool fromArguments = decoded->c != static_cast<u8>(ReturnSource::Registers);
	if constexpr (HeapService) {
		// The fixed bank admits only non-variadic activations.
		executeHeapServiceReturn(FRAME, fromArguments ? 0 : decoded->a, fromArguments ? 0 : decodeValueCount(decoded->b, -1));
		DISPATCH_REBIND_FRAME();
	}
	if (executeReturn(FRAME, decoded->a, decodeValueCount(decoded->b, -1), fromArguments)) {
		DISPATCH_REBIND_FRAME();
	}
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM_D) {
	PUBLISH_SCALAR_FRONTIER();
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(REG(decoded->b)) + (decoded->bx() << 2u);
	if constexpr (HeapService) {
		executeHeapServiceLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
		DISPATCH_CONTINUE();
	}
	executeMemoryLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_D) {
	PUBLISH_SCALAR_FRONTIER();
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(REG(decoded->b)) + (decoded->bx() << 2u);
	if constexpr (HeapService) {
		executeHeapServiceStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
		DISPATCH_CONTINUE();
	}
	if (!executeMemoryStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS_D) {
	PUBLISH_SCALAR_FRONTIER();
	const u32 address = wordOperand(REG(decoded->b)) + (decoded->bx() << 2u);
	if (!executeWordStores(FRAME, address, decoded->a, decoded->c)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOAD_MEM) {
	PUBLISH_SCALAR_FRONTIER();
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	if constexpr (HeapService) {
		executeHeapServiceLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
		DISPATCH_CONTINUE();
	}
	executeMemoryLoad(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM) {
	PUBLISH_SCALAR_FRONTIER();
	if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
	const u32 address = wordOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	if constexpr (HeapService) {
		executeHeapServiceStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address);
		DISPATCH_CONTINUE();
	}
	if (!executeMemoryStore(FRAME, decoded->a, static_cast<MemoryAccessKind>(decoded->c), address)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(STORE_MEM_WORDS) {
	PUBLISH_SCALAR_FRONTIER();
	const u32 address = wordOperand(readRK(IMAGE, FRAME.registers, decoded->b));
	if (!executeWordStores(FRAME, address, decoded->a, decoded->c)) DISPATCH_BLOCKED();
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(RFE) {
	PUBLISH_SCALAR_FRONTIER();
	returnFromException(FRAME);
	DISPATCH_CONTINUE();
}

DISPATCH_LABEL(LOADKR) {
	const int a = decoded->a;
	const int b = decoded->b;
	const u32 constantIndex = wordOperand(REG(b));
	if (constantIndex >= IMAGE.constPool.size() || IMAGE.constPool.tag(constantIndex) == ValueTag::UnboundStringLiteral) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	SET_REGISTER_FAST(a, IMAGE.constPool.get(constantIndex));
	DISPATCH_NEXT();
}
