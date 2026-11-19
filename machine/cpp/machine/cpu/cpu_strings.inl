// Concatenation owns operand conversion, assembly and the allocating intern.
// Both execution backends enter with the completed prefix published as roots.

inline void CPU::executeConcat(CallFrame& frame, int destination, int leftOperand, int rightOperand) {
	const Value left = readRK(*frame.executionImage, frame.registers, leftOperand);
	const Value right = readRK(*frame.executionImage, frame.registers, rightOperand);
	size_t stringByteCount = 0;
	if (valueIsString(left)) stringByteCount += m_stringPool.byteLength(asStringId(left));
	if (valueIsString(right)) stringByteCount += m_stringPool.byteLength(asStringId(right));
	std::string text;
	text.reserve(stringByteCount);
	const int leftCount = appendValueString(text, left, m_stringPool);
	const int rightCount = appendValueString(text, right, m_stringPool);
	instructionBudgetRemaining -= leftCount + rightCount;
	const StringId id = m_stringPool.intern(text);
	frame.registers.set(destination, valueString(id));
	frame.setTop(std::max(frame.readWindow(FrameField::Top), destination + 1));
}

inline void CPU::executeConcatRange(CallFrame& frame, int destination, int base, int count) {
	size_t stringByteCount = 0;
	for (int index = 0; index < count; ++index) {
		const Value value = frame.registers.get(base + index);
		if (valueIsString(value)) stringByteCount += m_stringPool.byteLength(asStringId(value));
	}
	std::string text;
	text.reserve(stringByteCount);
	int byteWork = 0;
	for (int index = 0; index < count; ++index) byteWork += appendValueString(text, frame.registers.get(base + index), m_stringPool);
	instructionBudgetRemaining -= count + byteWork;
	const StringId id = m_stringPool.intern(text);
	frame.registers.set(destination, valueString(id));
	frame.setTop(std::max(frame.readWindow(FrameField::Top), destination + 1));
}
