// Both backends publish the operand roots before entering the allocating intern.
template <class Operand>
inline StringId concatenateValues(StringPool& strings, int& cycles, int count, Operand operand) {
	const auto oversized = [&] {
		cycles -= static_cast<int>(MAIN_RAM_SIZE);
		throw LuaOutOfMemorySignal{};
	};
	if (count == 2) {
		const Value left = operand(0), right = operand(1);
		if (valueIsString(left) && valueIsString(right)) {
			const auto a = asStringId(left), b = asStringId(right);
			const u32 n = strings.byteLength(a), m = strings.byteLength(b);
			if (n >= MAIN_RAM_SIZE || m >= MAIN_RAM_SIZE - n) oversized();
			cycles -= static_cast<int>(n + m);
			return strings.internConcat(a, n, b, m);
		}
	}
	u32 stringBytes = 0, conversions = 0;
	for (int index = 0; index < count; ++index) {
		const Value value = operand(index);
		if (valueIsString(value)) {
			const u32 length = strings.byteLength(asStringId(value));
			if (length >= MAIN_RAM_SIZE - stringBytes) oversized();
			stringBytes += length;
		} else ++conversions;
	}
	// Only a mixed range at the length boundary needs the exact converted
	// sizes before assembly. Ordinary numeric operands are formatted once.
	if (conversions * MAX_NON_STRING_TEXT_BYTES >= MAIN_RAM_SIZE - stringBytes) {
		for (int index = 0; index < count; ++index) {
			const Value v = operand(index);
			if (!valueIsString(v)) {
				stringBytes += static_cast<u32>(valueToString(v, strings).size());
				if (stringBytes >= MAIN_RAM_SIZE) oversized();
			}
		}
	}
	std::string text;
	text.reserve(stringBytes);
	for (int index = 0; index < count; ++index) {
		appendValueString(text, operand(index), strings);
	}
	cycles -= static_cast<int>(text.size());
	return strings.intern(text);
}

inline void CPU::executeConcat(CallFrame& frame, int destination, int leftOperand, int rightOperand) {
	const Value left = readRK(*frame.executionImage, frame.registers, leftOperand);
	const Value right = readRK(*frame.executionImage, frame.registers, rightOperand);
	const auto id = concatenateValues(m_stringPool, instructionBudgetRemaining, 2, [&](int i) { return i ? right : left; });
	frame.registers.set(destination, valueString(id));
	frame.extendTop(destination + 1);
}

inline void CPU::executeConcatRange(CallFrame& frame, int destination, int base, int count) {
	instructionBudgetRemaining -= count;
	const auto id = concatenateValues(m_stringPool, instructionBudgetRemaining, count, [&](int i) { return frame.registers.get(base + i); });
	frame.registers.set(destination, valueString(id));
	frame.extendTop(destination + 1);
}
