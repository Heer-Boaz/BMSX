#include "machine/runtime/runtime.h"

#include "machine/cpu/disassembler.h"

#include <iostream>
#include <sstream>

namespace bmsx {

void Runtime::logDebugState() const {
	if (!m_program || m_program->code.empty()) {
		return;
	}
	if (m_machine.cpu().lastPc < 0 || m_machine.cpu().lastPc >= static_cast<int>(m_program->code.size())) {
		return;
	}
	const InstructionDebugInfo instruction = describeInstructionAtPc(*m_program, m_programMetadata, m_machine.cpu().lastPc);
	const int topFrameIndex = m_machine.cpu().getFrameDepth() - 1;
	const int registerCount = topFrameIndex >= 0 ? m_machine.cpu().getFrameRegisterCount(topFrameIndex) : 0;
	std::ostringstream summary;
	summary << "[Runtime] debug: pc=" << instruction.pcText << " op=" << instruction.opName;
	for (const InstructionOperandDebugInfo& operand : instruction.operands) {
		summary << ' ' << operand.label << '=' << operand.text;
		if (operand.registerIndex.has_value() && *operand.registerIndex < registerCount) {
			summary << '(' << valueToString(m_machine.cpu().readFrameRegister(topFrameIndex, *operand.registerIndex)) << ')';
		}
	}
	std::cout << summary.str() << std::endl;
	std::cout << "[Runtime] debug: instr=" << instruction.pcText << ": " << instruction.instructionText << std::endl;
	if (instruction.sourceRange.has_value()) {
		const SourceRange& range = *instruction.sourceRange;
		std::string sourceLine = range.path + ":" + std::to_string(range.startLine) + ":" + std::to_string(range.startColumn);
		std::cout << "[Runtime] debug: source=" << sourceLine << std::endl;
	}
}

} // namespace bmsx
