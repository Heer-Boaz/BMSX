#include "machine/bus/io.h"
#include "machine/devices/gx/system_vram_port.h"
#include "machine/memory/memory.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void testCompletedTransfersPublishAndWrapInsideSystemVram() {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory(bmsx::MemoryInit{{emptyRom.data(), 0u}, {emptyRom.data(), 0u}});
	bmsx::GxGpuSystemVramPort port(memory);
	port.reset();

	const bmsx::u32 positionWord = 0x00ff00ffu;
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_POSITION, positionWord);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_SIZE, 0x00020002u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_CONTROL, bmsx::GX_GPU_SYSTEM_VRAM_PORT_CONTROL_START);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_DATA, 0x22221111u);
	require(port.commandCount == 0u, "GX system VRAM port must not publish an incomplete transfer");
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_DATA, 0x44443333u);
	require(port.commandCount == 1u, "GX system VRAM port publishes a completed transfer");
	require(port.words[0u] == 0x22221111u && port.words[1u] == 0x44443333u, "GX system VRAM port preserves packed A1RGB555 words");
	require(bmsx::gxGpuSystemVramColumnX(positionWord, 0u) == 767u
		&& bmsx::gxGpuSystemVramColumnX(positionWord, 1u) == 512u
		&& bmsx::gxGpuSystemVramRowY(positionWord, 0u) == 255u
		&& bmsx::gxGpuSystemVramRowY(positionWord, 1u) == 0u,
		"GX system VRAM port wraps only within its 256x256 physical window");

	port.sealForPresentation();
	require(port.presentCommandCount == 1u, "GX system VRAM port seals completed transfers for scanout");
	port.retirePresentedCommands();
	require(port.commandCount == 0u && port.wordCount == 0u, "GX system VRAM port retires the presented transfer");
}

} // namespace

int main() {
	testCompletedTransfersPublishAndWrapInsideSystemVram();
	return 0;
}
