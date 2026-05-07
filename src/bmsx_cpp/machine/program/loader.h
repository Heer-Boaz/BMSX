#pragma once

#include "machine/cpu/cpu.h"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <variant>
#include <vector>

namespace bmsx {

constexpr const char* PROGRAM_IMAGE_ID = "__program__";
constexpr const char* PROGRAM_SYMBOLS_IMAGE_ID = "__program_symbols__";
constexpr uint32_t PROGRAM_BOOT_HEADER_VERSION = 1;

using EncodedValue = std::variant<std::nullptr_t, bool, double, std::string>;

struct ProgramTextSection {
	std::vector<uint8_t> code;
	std::vector<Proto> protos;
};

struct ProgramRodataSection {
	std::vector<EncodedValue> constPool;
	std::vector<std::pair<std::string, int>> moduleProtos;
	std::vector<std::string> staticModulePaths;
};

struct ProgramDataSection {
	std::vector<uint8_t> bytes;
};

struct ProgramBssSection {
	size_t byteCount = 0;
};

struct ProgramObjectSections {
	ProgramTextSection text;
	ProgramRodataSection rodata;
	ProgramDataSection data;
	ProgramBssSection bss;
};

/**
 * ProgramImage - deserialized pre-compiled Lua program.
 */
struct ProgramImage {
	enum class ConstRelocKind {
		Bx,
		RkB,
		RkC,
		// Specialized table ops store a direct const index in operand B/C instead of an RK encoding.
		// The C++ loader/linker must recognize these kinds so release/libretro can load ROMs emitted
		// by the current TS compiler without rejecting them or patching the wrong operand shape.
		ConstB,
		ConstC,
		Gl,
		Sys,
		// Reloc kind for module export placeholders emitted by the TypeScript
		// compiler when an external module export cannot be resolved at compile time.
		// The linker must resolve these into GETSYS/GETGL accesses.
		Module,
	};

	struct ConstReloc {
		int wordIndex = 0;
		ConstRelocKind kind = ConstRelocKind::Bx;
		int constIndex = 0;
	};

	struct LinkInfo {
		std::vector<ConstReloc> constRelocs;
	};

	int entryProtoIndex = 0;
	ProgramObjectSections sections;
	LinkInfo link;
};

std::unique_ptr<Program> inflateProgram(const ProgramObjectSections& sections);

/**
 * ProgramLoader - loads pre-compiled bytecode from ROM.
 *
 * The rompacker compiles Lua to bytecode at build time using the TypeScript
 * compiler.ts and encodes it with binencoder. This class deserializes
 * that bytecode for the C++ runtime.
 */
class ProgramLoader {
public:
	/**
	 * Load a ProgramImage from binary data.
	 * The binary format is produced by the TS rompacker as a sectioned
	 * ProgramImage: .text, .rodata, .data, .bss, plus link metadata.
	 */
	static std::unique_ptr<ProgramImage> load(const uint8_t* data, size_t size);

	/**
	 * Load program symbols (ProgramMetadata) from binary data.
	 * The binary format is produced by asset.ts::encodeProgramSymbolsAsset.
	 */
	static std::unique_ptr<ProgramMetadata> loadSymbols(const uint8_t* data, size_t size);

	/**
	 * Load a ProgramImage from a vector.
	 */
	static std::unique_ptr<ProgramImage> load(const std::vector<uint8_t>& data) {
		return load(data.data(), data.size());
	}

private:
	ProgramLoader() = default;
};

} // namespace bmsx
