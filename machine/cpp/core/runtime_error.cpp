#include "core/machine_manager.h"

#include "machine/cpu/disassembler.h"
#include "machine/runtime/runtime.h"

#include <iomanip>
#include <optional>
#include <sstream>

namespace bmsx {

const Blua32ImageLayout& MachineManager::blua32LayoutForDomain(
	int executionDomainId
) const {
	if (executionDomainId < 0) {
		return *m_systemBlua32Layout;
	}
	return *m_cartridgeBlua32Layouts[static_cast<size_t>(executionDomainId)];
}

void MachineManager::reportRuntimeError(
	Runtime& runtime,
	std::string_view message
) {
	runtime.enterFaultState();
	log(LogLevel::Error, "Runtime error: %.*s", static_cast<int>(message.size()), message.data());

	CPU& cpu = runtime.machine.cpu;
	const int frameDepth = cpu.getFrameDepth();
	const int topFrameIndex = frameDepth - 1;
	const int executionDomainId = cpu.readLastExecutionDomain();
	const Blua32ImageLayout& image = blua32LayoutForDomain(executionDomainId);
	const Blua32SymbolsImage* symbols =
		blua32SymbolsForSlot(m_blua32MediaSymbols, executionDomainId);
	const InstructionDebugInfo instruction = describeInstructionAtPc(
		image,
		symbols,
		cpu.lastPc
	);
	int instructionFrameIndex = -1;
	for (int frameIndex = topFrameIndex; frameIndex >= 0; --frameIndex) {
		if (cpu.readFrameExecutionDomain(frameIndex) != executionDomainId) {
			continue;
		}
		const u32 functionAddress = cpu.readFrameFunctionAddress(frameIndex);
		const u32 functionIndex = blua32FunctionIndexAtAddress(image, functionAddress);
		const Blua32FunctionRecord& function = image.functions[functionIndex];
		if (cpu.lastPc >= function.codeAddress
			&& cpu.lastPc < function.codeAddress + function.codeByteCount) {
			instructionFrameIndex = frameIndex;
			break;
		}
	}
	const int registerCount = instructionFrameIndex >= 0
		? cpu.getFrameRegisterCount(instructionFrameIndex)
		: 0;
	std::ostringstream summary;
	summary << "debug: pc=" << instruction.pcText << " op=" << instruction.opName;
	for (const InstructionOperandDebugInfo& operand : instruction.operands) {
		summary << ' ' << operand.label << '=' << operand.text;
		if (operand.registerIndex.has_value() && *operand.registerIndex < registerCount) {
			summary << '(' << valueToString(
				cpu.readFrameRegister(instructionFrameIndex, *operand.registerIndex),
				cpu.stringPool()
			) << ')';
		}
	}
	m_platform->log(LogLevel::Error, summary.str());
	m_platform->log(
		LogLevel::Error,
		"debug: instr=" + instruction.pcText + ": " + instruction.instructionText
	);
	if (instruction.sourceRange.has_value()) {
		const SourceRange& range = *instruction.sourceRange;
		std::ostringstream source;
		source << "debug: source=" << range.path << ':'
			<< range.start.line << ':' << range.start.column;
		m_platform->log(LogLevel::Error, source.str());
	}

	if (frameDepth == 0) {
		const std::optional<SourceRange> range = symbols
			? blua32SourceRangeAtPc(*symbols, image.header.textAddress, cpu.lastPc)
			: std::nullopt;
		std::ostringstream frame;
		if (range.has_value()) {
			frame << "  at <current> (" << range->path << ':'
				<< range->start.line << ':' << range->start.column << ')';
		} else {
			frame << "  at <current> (pc=0x" << std::hex << cpu.lastPc << ')';
		}
		m_platform->log(LogLevel::Error, frame.str());
		return;
	}

	for (int frameIndex = 0; frameIndex < frameDepth; ++frameIndex) {
		const int frameDomainId = cpu.readFrameExecutionDomain(frameIndex);
		const Blua32ImageLayout& frameImage = blua32LayoutForDomain(frameDomainId);
		const Blua32SymbolsImage* frameSymbols =
			blua32SymbolsForSlot(m_blua32MediaSymbols, frameDomainId);
		const u32 functionAddress = cpu.readFrameFunctionAddress(frameIndex);
		const u32 functionIndex =
			blua32FunctionIndexAtAddress(frameImage, functionAddress);
		const Blua32FunctionRecord& function = frameImage.functions[functionIndex];
		const u32 pc = frameIndex + 1 < frameDepth
			? cpu.readFrameCallSitePc(frameIndex + 1)
			: executionDomainId == frameDomainId
				&& cpu.lastPc >= function.codeAddress
				&& cpu.lastPc < function.codeAddress + function.codeByteCount
				? cpu.lastPc
				: cpu.readFramePc(frameIndex);
		std::ostringstream frame;
		if (frameSymbols) {
			frame << "  at " << frameSymbols->metadata.functionIds[functionIndex];
			const std::optional<SourceRange> range = blua32SourceRangeAtPc(
				*frameSymbols,
				frameImage.header.textAddress,
				pc
			);
			if (range.has_value()) {
				frame << " (" << range->path << ':'
					<< range->start.line << ':' << range->start.column << ')';
				m_platform->log(LogLevel::Error, frame.str());
				continue;
			}
		} else {
			frame << "  at function@0x" << std::hex << functionAddress << std::dec;
		}
		frame << " (pc=0x" << std::hex << pc << ')';
		m_platform->log(LogLevel::Error, frame.str());
	}
}

} // namespace bmsx
