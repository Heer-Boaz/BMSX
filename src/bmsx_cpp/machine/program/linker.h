#pragma once

#include "machine/program/loader.h"
#include <memory>
#include <string>

namespace bmsx {

struct LinkedProgramAsset {
	std::unique_ptr<ProgramAsset> program;
	std::unique_ptr<ProgramMetadata> metadata;
};

LinkedProgramAsset linkProgramAssets(
	const ProgramAsset& engineAsset,
	const ProgramMetadata* engineSymbols,
	const ProgramAsset& cartAsset,
	const ProgramMetadata* cartSymbols,
	int engineBasePc = 0,
	int cartBasePc = 0x80000
);

} // namespace bmsx
