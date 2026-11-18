// Concatenation owns operand conversion, assembly and the allocating intern.
// Both execution backends enter with the completed prefix published as roots.

inline void CPU::executeConcat(CallFrame& frame, int destination, int leftOperand, int rightOperand) {
	const Value left = readRK(*frame.executionImage, frame.registers, leftOperand);
	const Value right = readRK(*frame.executionImage, frame.registers, rightOperand);
	size_t stringByteCount = 0;
	if (valueIsString(left)) stringByteCount += m_stringPool.toString(asStringId(left)).size();
	if (valueIsString(right)) stringByteCount += m_stringPool.toString(asStringId(right)).size();
	std::string text;
	text.reserve(stringByteCount);
	const int leftCount = appendValueString(text, left, m_stringPool);
	const int rightCount = appendValueString(text, right, m_stringPool);
	instructionBudgetRemaining -= leftCount + rightCount;
	const StringId id = m_stringPool.internOwned(std::move(text));
	frame.registers.set(destination, valueString(id));
	frame.top = std::max(frame.top, destination + 1);
}

inline void CPU::executeConcatRange(CallFrame& frame, int destination, int base, int count) {
	size_t stringByteCount = 0;
	for (int index = 0; index < count; ++index) {
		const Value value = frame.registers.get(base + index);
		if (valueIsString(value)) stringByteCount += m_stringPool.toString(asStringId(value)).size();
	}
	std::string text;
	text.reserve(stringByteCount);
	int codepoints = 0;
	for (int index = 0; index < count; ++index) codepoints += appendValueString(text, frame.registers.get(base + index), m_stringPool);
	instructionBudgetRemaining -= count + codepoints;
	const StringId id = m_stringPool.internOwned(std::move(text));
	frame.registers.set(destination, valueString(id));
	frame.top = std::max(frame.top, destination + 1);
}
