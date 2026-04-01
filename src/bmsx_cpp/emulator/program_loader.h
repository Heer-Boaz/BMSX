#pragma once

#include "cpu.h"
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

/**
 * ProgramAsset - deserialized pre-compiled Lua program.
 *
 * This mirrors the TypeScript ProgramAsset structure.
 */
struct ProgramAsset {
	enum class ConstRelocKind {
		Bx,
		RkB,
		RkC,
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
	LinkInfo link;
};

/**
 * ProgramLoader - loads pre-compiled bytecode from ROM.
 *
 * The rompacker compiles Lua to bytecode at build time using the TypeScript
 * program_compiler and encodes it with binencoder. This class deserializes
 * that bytecode for the C++ runtime.
 */
class ProgramLoader {
public:
	/**
	 * Load a ProgramAsset from binary data.
	 * The binary format is produced by program_asset.ts::encodeProgramAsset.
	 */
	static std::unique_ptr<ProgramAsset> load(const uint8_t* data, size_t size);

	/**
	 * Load program symbols (ProgramMetadata) from binary data.
	 * The binary format is produced by program_asset.ts::encodeProgramSymbolsAsset.
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
