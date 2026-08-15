#include "runtime_error.h"

#include "machine/devices/system/controller.h"
#include "machine/runtime/runtime.h"
#include "rompack/tooling/blua32_media.h"
#include "rompack/tooling/disassembler.h"

#include <array>
#include <iomanip>
#include <optional>
#include <sstream>
#include <string>

namespace bmsx {

void flushLibretroSystemOutput(
	Runtime& runtime,
	const retro_log_callback& logging
) {
	SystemDebugTransmit& output = runtime.machine.systemDebugTransmit;
	const u32 byteCount = output.availableByteCount();
	if (byteCount == 0u) {
		return;
	}
	std::array<char, SYS_PRINT_BUFFER_BYTES> bytes;
	for (u32 index = 0u; index < byteCount; ++index) {
		bytes[index] = static_cast<char>(output.readByte());
	}
	size_t lineStart = 0u;
	for (u32 index = 0u; index < byteCount; ++index) {
		if (bytes[index] == '\n') {
			const std::string_view line(
				bytes.data() + lineStart,
				static_cast<size_t>(index) - lineStart);
			logging.log(
				RETRO_LOG_INFO,
				"%.*s",
				static_cast<int>(line.size()),
				line.data());
			lineStart = static_cast<size_t>(index) + 1u;
		}
	}
}

void reportLibretroRuntimeError(
	Runtime& runtime,
	const RomImage& systemRom,
	const std::array<RomImage, CARTRIDGE_SLOT_COUNT>& cartridgeRoms,
	std::string_view message,
	const retro_log_callback& logging
) {
	runtime.suspendExecution();
	std::ostringstream runtimeError;
	runtimeError << "Runtime error: " << message;
	const std::string runtimeErrorText = runtimeError.str();
	logging.log(RETRO_LOG_ERROR, "%s", runtimeErrorText.c_str());

	CPU& cpu = runtime.machine.cpu;
	Blua32ToolingMedia toolingMedia;
	toolingMedia.system = loadBlua32ToolingImage(
		systemRom,
		SYSTEM_ROM_BASE
	);
	for (u32 slot = 0u; slot < CARTRIDGE_SLOT_COUNT; ++slot) {
		const RomImage& image = cartridgeRoms[slot];
		if (!image.bytes.empty()) {
			toolingMedia.cartridgeSlots[slot] =
				loadBlua32ToolingImage(image, CART_ROM_BASE);
		}
	}
	const int frameDepth = cpu.getFrameDepth();
	const int topFrameIndex = frameDepth - 1;
	const int executionDomainId = cpu.readLastExecutionDomain();
	const Blua32ToolingImage& toolingImage =
		*blua32ToolingImageForDomain(toolingMedia, executionDomainId);
	const Blua32ImageLayout& image = toolingImage.layout;
	const Blua32SymbolsImage* instructionSymbols = nullptr;
	if (toolingImage.symbols) {
		instructionSymbols = &*toolingImage.symbols;
	}
	const InstructionDebugInfo instruction = describeBlua32InstructionAtPc(
		image,
		instructionSymbols,
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
		if (operand.registerIndex && *operand.registerIndex < registerCount) {
			summary << '(' << valueToString(
				cpu.readFrameRegister(instructionFrameIndex, *operand.registerIndex),
				cpu.stringPool()
			) << ')';
		}
	}
	const std::string summaryText = summary.str();
	logging.log(RETRO_LOG_ERROR, "%s", summaryText.c_str());
	const std::string instructionText =
		"debug: instr=" + instruction.pcText + ": " + instruction.instructionText;
	logging.log(RETRO_LOG_ERROR, "%s", instructionText.c_str());
	if (instruction.sourceRange) {
		const SourceRange& range = *instruction.sourceRange;
		std::ostringstream source;
		source << "debug: source=" << range.path << ':'
			<< range.start.line << ':' << range.start.column;
		const std::string sourceText = source.str();
		logging.log(RETRO_LOG_ERROR, "%s", sourceText.c_str());
	}

	if (frameDepth == 0) {
		std::optional<SourceRange> range;
		if (toolingImage.symbols) {
			range = blua32SourceRangeAtPc(
				*toolingImage.symbols,
				image.header.textAddress,
				cpu.lastPc);
		}
		std::ostringstream frame;
		if (range) {
			frame << "  at <current> (" << range->path << ':'
				<< range->start.line << ':' << range->start.column << ')';
		} else {
			frame << "  at <current> (pc=0x" << std::hex << cpu.lastPc << ')';
		}
		const std::string frameText = frame.str();
		logging.log(RETRO_LOG_ERROR, "%s", frameText.c_str());
		return;
	}

	for (int frameIndex = 0; frameIndex < frameDepth; ++frameIndex) {
		const int frameDomainId = cpu.readFrameExecutionDomain(frameIndex);
		const Blua32ToolingImage& frameToolingImage =
			*blua32ToolingImageForDomain(toolingMedia, frameDomainId);
		const Blua32ImageLayout& frameImage = frameToolingImage.layout;
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
		if (frameToolingImage.symbols) {
			const Blua32SymbolsImage& frameSymbols = *frameToolingImage.symbols;
			frame << "  at " << frameSymbols.metadata.functionIds[functionIndex];
			const std::optional<SourceRange> range = blua32SourceRangeAtPc(
				frameSymbols,
				frameImage.header.textAddress,
				pc
			);
			if (range) {
				frame << " (" << range->path << ':'
					<< range->start.line << ':' << range->start.column << ')';
				const std::string frameText = frame.str();
				logging.log(RETRO_LOG_ERROR, "%s", frameText.c_str());
				continue;
			}
		} else {
			frame << "  at function@0x" << std::hex << functionAddress << std::dec;
		}
		frame << " (pc=0x" << std::hex << pc << ')';
		const std::string frameText = frame.str();
		logging.log(RETRO_LOG_ERROR, "%s", frameText.c_str());
	}
}

} // namespace bmsx
