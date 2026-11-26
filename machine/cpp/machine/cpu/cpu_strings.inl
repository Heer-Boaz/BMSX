// Both backends publish the operand roots before entering the allocating intern.
template <class Operand>
inline StringId concatenateValues(StringPool& strings, int& cycles, int count, Operand operand) {
	const auto oversized = [&] {
		cycles -= static_cast<int>(MAIN_RAM_SIZE);
		throw LuaOutOfMemorySignal{};
	};
	u32 stringBytes = 0;
	for (int index = 0; index < count; ++index) {
		const Value value = operand(index);
		if (valueIsString(value)) {
			const u32 length = strings.byteLength(asStringId(value));
			if (length >= MAIN_RAM_SIZE - stringBytes) oversized();
			stringBytes += length;
		}
	}
	std::string text;
	text.reserve(stringBytes);
	for (int index = 0; index < count; ++index) {
		appendValueString(text, operand(index), strings);
		if (text.size() >= MAIN_RAM_SIZE) oversized();
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
