#pragma once

#include "machine/cpu/cpu.h"
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

/**
 * ProgramAsset - deserialized pre-compiled Lua program.
 */
struct ProgramAsset {
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
	std::unique_ptr<Program> program;
	std::vector<std::pair<std::string, int>> moduleProtos;  // path -> protoIndex
	std::vector<std::pair<std::string, std::string>> moduleAliases;  // alias -> path
	std::vector<std::string> staticModulePaths;
	LinkInfo link;
};

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
	 * Load a ProgramAsset from binary data.
	 * The binary format is produced by asset.ts::encodeProgramAsset.
	 */
	static std::unique_ptr<ProgramAsset> load(const uint8_t* data, size_t size);

	/**
	 * Load program symbols (ProgramMetadata) from binary data.
	 * The binary format is produced by asset.ts::encodeProgramSymbolsAsset.
	 */
	static std::unique_ptr<ProgramMetadata> loadSymbols(const uint8_t* data, size_t size);

	/**
	 * Load a ProgramAsset from a vector.
	 */
	static std::unique_ptr<ProgramAsset> load(const std::vector<uint8_t>& data) {
		return load(data.data(), data.size());
	}

private:
	ProgramLoader() = default;
};

} // namespace bmsx
