#pragma once

#include "cpu.h"
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

/**
 * VmProgramAsset - deserialized pre-compiled Lua program.
 *
 * This mirrors the TypeScript VmProgramAsset structure.
 */
struct VmProgramAsset {
	int entryProtoIndex = 0;
	std::unique_ptr<Program> program;
	std::vector<std::pair<std::string, int>> moduleProtos;  // path -> protoIndex
	std::vector<std::pair<std::string, std::string>> moduleAliases;  // alias -> path
};

/**
 * ProgramLoader - loads pre-compiled bytecode from ROM.
 *
 * The rompacker compiles Lua to bytecode at build time using the TypeScript
 * program_compiler and encodes it with binencoder. This class deserializes
 * that bytecode for the C++ VM.
 */
class ProgramLoader {
public:
	/**
	 * Load a VmProgramAsset from binary data.
	 * The binary format is produced by vm_program_asset.ts::encodeProgramAsset.
	 */
	static std::unique_ptr<VmProgramAsset> load(const uint8_t* data, size_t size);

	/**
	 * Load VM program symbols (ProgramMetadata) from binary data.
	 * The binary format is produced by vm_program_asset.ts::encodeProgramSymbolsAsset.
	 */
	static std::unique_ptr<ProgramMetadata> loadSymbols(const uint8_t* data, size_t size);

	/**
	 * Load a VmProgramAsset from a vector.
	 */
	static std::unique_ptr<VmProgramAsset> load(const std::vector<uint8_t>& data) {
		return load(data.data(), data.size());
	}

private:
	ProgramLoader() = default;
};

} // namespace bmsx
