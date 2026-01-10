#pragma once

#include "program_loader.h"
#include <memory>

namespace bmsx {

struct LinkedProgramAsset {
	std::unique_ptr<VmProgramAsset> program;
	std::unique_ptr<ProgramMetadata> metadata;
};

LinkedProgramAsset linkProgramAssets(
	const VmProgramAsset& engineAsset,
	const ProgramMetadata* engineSymbols,
	const VmProgramAsset& cartAsset,
	const ProgramMetadata* cartSymbols,
	int engineBasePc = 0,
	int cartBasePc = 0x80000
);

} // namespace bmsx
