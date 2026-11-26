inline void CPU::beginStringComparison(CallFrame& frame, StringId a, StringId b, bool inclusive, bool expected) {
	const int an = m_stringPool.byteLength(a), bn = m_stringPool.byteLength(b);
	m_stringComparison = {a, b, 0, static_cast<u32>(std::min(an, bn)), 0, !expected,
		(inclusive ? an <= bn : an < bn) != expected};
	if (instructionBudgetRemaining > 0) advanceStringComparison(frame);
}

inline void CPU::advanceStringComparison(CallFrame& frame) {
	auto& scan = m_stringComparison;
	const u32 n = std::min(scan.remaining, static_cast<u32>(instructionBudgetRemaining));
	if (scan.order == 0) {
		const int delta = m_stringPool.compareBytes(scan.left, scan.right, scan.offset, n);
		scan.order = (delta > 0) - (delta < 0);
	}
	scan.offset += n;
	scan.remaining -= n;
	instructionBudgetRemaining -= static_cast<int>(n);
	if (scan.remaining != 0) return;
	const bool skip = scan.order == 0 ? scan.skipTie : (scan.order < 0) == scan.skipLess;
	scan = {};
	if (skip) skipNextInstruction(frame);
}
