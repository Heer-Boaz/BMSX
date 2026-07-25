#include "machine/runtime/runtime.h"

#include "machine/cpu/disassembler.h"

#include <iostream>
#include <sstream>

namespace bmsx {

void Runtime::logDebugState() const {
	const CpuDebugState debug = machine.cpu.getDebugState();
	if (!debug.image) {
		return;
	}
	const InstructionDebugInfo instruction = describeInstructionAtPc(
		*debug.image,
		blua32SymbolsForSlot(m_blua32MediaSymbols, debug.slot),
		debug.pc
	);
	const int topFrameIndex = machine.cpu.getFrameDepth() - 1;
	const int registerCount = topFrameIndex >= 0
		? machine.cpu.getFrameRegisterCount(topFrameIndex)
		: 0;
	std::ostringstream summary;
	summary << "debug: pc=" << instruction.pcText << " op=" << instruction.opName;
	for (const InstructionOperandDebugInfo& operand : instruction.operands) {
		summary << ' ' << operand.label << '=' << operand.text;
		if (operand.registerIndex.has_value() && *operand.registerIndex < registerCount) {
			summary << '(' << valueToString(
				machine.cpu.readFrameRegister(topFrameIndex, *operand.registerIndex),
				machine.cpu.stringPool()
			) << ')';
		}
	}
	std::cerr << summary.str() << std::endl;
	std::cerr << "debug: instr=" << instruction.pcText << ": " << instruction.instructionText << std::endl;
	if (instruction.sourceRange.has_value()) {
		const SourceRange& range = *instruction.sourceRange;
		std::cerr << "debug: source=" << range.path << ':'
			<< range.start.line << ':' << range.start.column << std::endl;
	}
}

} // namespace bmsx
