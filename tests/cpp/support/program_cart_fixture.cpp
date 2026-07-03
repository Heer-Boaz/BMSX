#include "program_cart_fixture.h"

#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/program/loader.h"
#include "rompack/format.h"

#include <span>

namespace bmsx::test {
namespace {

ProgramImage makeMinimalProgramImage() {
	ProgramImage image;
	image.vectors.resetProtoIndex = 0;
	image.vectors.sectionInitProtoIndex = 0;
	image.vectors.irqProtoIndex = 0;
	image.sections.text.code.resize(INSTRUCTION_BYTES);
	writeInstruction(std::span<u8>(image.sections.text.code), 0, static_cast<u8>(OpCode::RET), 0, 0, 0);

	Proto proto;
	proto.entryPC = 0;
	proto.codeLen = INSTRUCTION_BYTES;
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
	manifest.vdpClass = MachineVdpClass::Psx;
	return manifest;
}

} // namespace

std::vector<u8> makeMinimalProgramCartRom() {
	return encodeProgramCartRom(makeMinimalCartManifest(), makeMinimalMachineManifest(), makeMinimalProgramImage());
}

} // namespace bmsx::test
