#include "boot_rom_fixture.h"

#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/firmware/boot_primitives.h"
#include "machine/program/loader.h"
#include "machine/memory/map.h"
#include "rompack/format.h"

#include <span>

namespace bmsx::test {
namespace {

std::vector<u8> makeMinimalProgramCode() {
	std::vector<u8> code(INSTRUCTION_BYTES);
	writeInstruction(std::span<u8>(code), 0, static_cast<u8>(OpCode::RET), 0, 0, 0);
	return code;
}

ProgramImage makeMinimalProgramImage(ProgramBootTarget target, std::span<const u8> code) {
	ProgramImage image;
	const bool cart = target == ProgramBootTarget::Cart;
	const int protoBaseIndex = cart ? 1 : 0;
	const int textBasePc = cart ? INSTRUCTION_BYTES : 0;
	image.placement.textBasePc = textBasePc;
	image.placement.protoBaseIndex = protoBaseIndex;
	image.placement.dataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	image.placement.bssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	image.vectors.resetProtoIndex = protoBaseIndex;
	image.vectors.sectionInitProtoIndex = protoBaseIndex;
	image.vectors.irqProtoIndex = protoBaseIndex;
	image.vectors.exceptionProtoIndex = protoBaseIndex;
	image.sections.text.code = code;

	Proto proto;
	proto.entryPC = textBasePc;
	proto.codeLen = INSTRUCTION_BYTES;
	proto.maxStack = 1;
	image.sections.text.protos.push_back(proto);
	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		image.symbols.systemGlobalNames.emplace_back(primitive.name);
	}
	return image;
}

CartManifest makeMinimalCartManifest() {
	CartManifest manifest;
	manifest.machine.namespaceName = "test";
	manifest.machine.vdpClass = MachineVdpClass::Psx;
	manifest.entryPath = "boot";
	return manifest;
}

} // namespace

std::vector<u8> makeMinimalBootRom(ProgramBootTarget target) {
	const std::vector<u8> code = makeMinimalProgramCode();
	return encodeProgramCartRom(makeMinimalCartManifest(), makeMinimalProgramImage(target, code));
}

} // namespace bmsx::test
