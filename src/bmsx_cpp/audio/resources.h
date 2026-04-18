#pragma once

#include "core/primitives.h"

namespace bmsx {

class Runtime;
class RuntimeAssets;
class SoundMaster;
struct MachineManifest;

void refreshAudioResources(
	SoundMaster& soundMaster,
	Runtime& runtime,
	const RuntimeAssets& assets,
	const MachineManifest& machineManifest,
	const u8* systemRomData,
	const u8* cartRomData
);

} // namespace bmsx
