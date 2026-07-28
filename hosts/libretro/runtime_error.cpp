#include "platform.h"

#include "core/machine_manager.h"
#include "machine/devices/system/controller.h"
#include "machine/runtime/runtime.h"
#include "rompack/tooling/blua32_media.h"
#include "rompack/tooling/disassembler.h"

#include <array>
#include <iomanip>
#include <optional>
#include <sstream>

namespace bmsx {

void LibretroPlatform::flushSystemOutput(Runtime& runtime) {
	SystemController& output = runtime.machine.systemController;
	const u32 byteCount = output.hostOutputAvailableByteCount();
	if (byteCount == 0u) {
		return;
	}
	std::array<char, SYS_PRINT_BUFFER_BYTES> bytes;
	for (u32 index = 0u; index < byteCount; ++index) {
		bytes[index] = static_cast<char>(output.readHostOutputByte());
	}
	size_t lineStart = 0u;
	for (u32 index = 0u; index < byteCount; ++index) {
		if (bytes[index] == '\n') {
			log(LogLevel::Info, std::string_view(
				bytes.data() + lineStart,
				static_cast<size_t>(index) - lineStart
			));
			lineStart = static_cast<size_t>(index) + 1u;
		}
	}
}

void LibretroPlatform::reportRuntimeError(
	Runtime& runtime,
	std::string_view message
) {
	runtime.enterFaultState();
	std::ostringstream runtimeError;
	runtimeError << "Runtime error: " << message;
	log(LogLevel::Error, runtimeError.str());

	CPU& cpu = runtime.machine.cpu;
	Blua32ToolingMedia toolingMedia;
	toolingMedia.system = loadBlua32ToolingImage(
		m_machine_manager->systemRomImage(),
		SYSTEM_ROM_BASE
	);
	for (u32 slot = 0u; slot < CARTRIDGE_SLOT_COUNT; ++slot) {
		const RomImage& image = m_machine_manager->cartridgeRomImage(slot);
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
	const Blua32SymbolsImage* symbols =
		toolingImage.symbols ? &*toolingImage.symbols : nullptr;
	const InstructionDebugInfo instruction = describeBlua32InstructionAtPc(
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
		if (operand.registerIndex && *operand.registerIndex < registerCount) {
			summary << '(' << valueToString(
				cpu.readFrameRegister(instructionFrameIndex, *operand.registerIndex),
				cpu.stringPool()
			) << ')';
		}
	}
	log(LogLevel::Error, summary.str());
	log(
		LogLevel::Error,
		"debug: instr=" + instruction.pcText + ": " + instruction.instructionText
	);
	if (instruction.sourceRange) {
		const SourceRange& range = *instruction.sourceRange;
		std::ostringstream source;
		source << "debug: source=" << range.path << ':'
			<< range.start.line << ':' << range.start.column;
		log(LogLevel::Error, source.str());
	}

	if (frameDepth == 0) {
		const std::optional<SourceRange> range = symbols
			? blua32SourceRangeAtPc(*symbols, image.header.textAddress, cpu.lastPc)
			: std::nullopt;
		std::ostringstream frame;
		if (range) {
			frame << "  at <current> (" << range->path << ':'
				<< range->start.line << ':' << range->start.column << ')';
		} else {
			frame << "  at <current> (pc=0x" << std::hex << cpu.lastPc << ')';
		}
		log(LogLevel::Error, frame.str());
		return;
	}

	for (int frameIndex = 0; frameIndex < frameDepth; ++frameIndex) {
		const int frameDomainId = cpu.readFrameExecutionDomain(frameIndex);
		const Blua32ToolingImage& frameToolingImage =
			*blua32ToolingImageForDomain(toolingMedia, frameDomainId);
		const Blua32ImageLayout& frameImage = frameToolingImage.layout;
		const Blua32SymbolsImage* frameSymbols =
			frameToolingImage.symbols ? &*frameToolingImage.symbols : nullptr;
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
			if (range) {
				frame << " (" << range->path << ':'
					<< range->start.line << ':' << range->start.column << ')';
				log(LogLevel::Error, frame.str());
				continue;
			}
		} else {
			frame << "  at function@0x" << std::hex << functionAddress << std::dec;
		}
		frame << " (pc=0x" << std::hex << pc << ')';
		log(LogLevel::Error, frame.str());
	}
}

} // namespace bmsx
