#include "program_cart_fixture.h"

#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/program/loader.h"
#include "machine/runtime/timing/constants.h"
#include "rompack/format.h"

namespace bmsx::test {
namespace {

ProgramImage makeMinimalProgramImage() {
	ProgramImage image;
	image.entryProtoIndex = 0;
	image.sections.text.code.resize(INSTRUCTION_BYTES);
	writeInstruction(image.sections.text.code, 0, static_cast<u8>(OpCode::RET), 0, 0, 0);

	Proto proto;
	proto.entryPC = 0;
	proto.maxStack = 1;
	image.sections.text.protos.push_back(proto);
	return image;
}

CartManifest makeMinimalCartManifest() {
	CartManifest manifest;
	manifest.name = "libretro_save_state_test";
	return manifest;
}

MachineManifest makeMinimalMachineManifest() {
	MachineManifest manifest;
	manifest.namespaceName = "libretro_save_state_test";
	manifest.viewportWidth = 256;
	manifest.viewportHeight = 212;
	manifest.cpuHz = 1'000'000;
	manifest.imgDecBytesPerSec = 26'214'400;
	manifest.dmaBytesPerSecIso = 8'388'608;
	manifest.dmaBytesPerSecBulk = 26'214'400;
	manifest.ufpsScaled = DEFAULT_UFPS_SCALED;
	return manifest;
}

} // namespace

std::vector<u8> makeMinimalProgramCartRom() {
	return encodeProgramCartRom(makeMinimalCartManifest(), makeMinimalMachineManifest(), makeMinimalProgramImage());
}

} // namespace bmsx::test
