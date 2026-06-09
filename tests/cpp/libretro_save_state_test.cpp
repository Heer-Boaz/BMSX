#include "core/machine_manager.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/rpu.h"
#include "machine/devices/vdp/rpu_desc.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "platform.h"
#include "support/program_cart_fixture.h"

#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void discardRetroLog(enum retro_log_level, const char*, ...) {
}

void testLibretroSaveStateRoundTrip() {
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
	platform.setLogCallback(discardRetroLog);
	require(platform.getStateSize() == 0u, "libretro state size should be zero before a ROM is loaded");

	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load and boot a program cart ROM");
	require(platform.machineManager()->romLoaded(), "MachineManager should mark the cart ROM loaded");
	require(platform.machineManager()->hasRuntime(), "MachineManager should own a runtime after cart boot");

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	require(runtime.isInitialized(), "cart program boot should initialize the runtime");
	const size_t stateSize = platform.getStateSize();
	require(stateSize > 0u, "libretro state size should come from initialized runtime state");

	bmsx::Memory& memory = runtime.machine.memory;
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x11223344u);
	memory.writeMappedU32LE(bmsx::IO_VDP_REG_BG_COLOR, 0xff112233u);
	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	require(platform.getStateSize() == stateSize, "libretro state size should remain stable across RAM and device-register changes");

	std::vector<bmsx::u8> saved(stateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro saveState should serialize initialized runtime state");

	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	memory.writeMappedU32LE(bmsx::IO_VDP_REG_BG_COLOR, 0xff445566u);
	runtime.machine.irqController.reset();
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0xaabbccddu, "RAM mutation should be visible before loadState");
	require(memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff445566u, "VDP register mutation should be visible before loadState");
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the maskable line before loadState");

	require(platform.loadState(saved.data(), stateSize), "libretro loadState should apply runtime state bytes");
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u, "libretro loadState should restore RAM through Runtime save state");
	require(memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff112233u, "libretro loadState should restore VDP raw registerfile state");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "libretro loadState should restore asserted IRQ line state");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "libretro loadState should restore cart-visible IRQ flags");

	constexpr uint32_t passDescAddr = 0x100u;
	constexpr uint32_t drawDescAddr = 0x140u;
	constexpr uint32_t streamDescAddr = 0x200u;
	constexpr uint32_t streamVramAddr = 0x300u;
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + streamVramAddr, 0x00112233u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + streamVramAddr + 4u, 0x44556677u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + streamVramAddr + 8u, 0x8899aabbu);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + streamDescAddr + bmsx::RPU_STREAM_DESC_VRAM_ADDR_OFFSET, streamVramAddr);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + streamDescAddr + bmsx::RPU_STREAM_DESC_BYTE_LENGTH_OFFSET, 36u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + streamDescAddr + bmsx::RPU_STREAM_DESC_LAYOUT_ID_OFFSET, bmsx::VDP_RPU_LAYOUT_V2_C4);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_SHADER_VARIANT_OFFSET, bmsx::VDP_RPU_SHADER_V2_C4 | (bmsx::VDP_RPU_PRIM_TRIANGLES << 16u));
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_PIPELINE_WORD_OFFSET, bmsx::VDP_RPU_PIPE_COLOR_WRITE_MASK);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_VERTEX_COUNT_OFFSET, 3u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INSTANCE_COUNT_OFFSET, 1u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INDEX_VRAM_ADDR_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INDEX_COUNT_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INDEX_TYPE_OFFSET, bmsx::VDP_RPU_INDEX_NONE | (1u << 8u));
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_STREAM_DESCS_ADDR_OFFSET, streamDescAddr);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_CONSTANT_DESCS_ADDR_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_TEXTURE_DESCS_ADDR_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_COLOR_SURFACE_DESC_ADDR_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_DEPTH_SURFACE_DESC_ADDR_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_VIEWPORT_XY_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_VIEWPORT_WH_OFFSET, 256u | (212u << 16u));
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_OPS_OFFSET, bmsx::VDP_RPU_PASS_COLOR_CLEAR);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_CLEAR_COLOR_OFFSET, 0xff112233u);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_CLEAR_DEPTH_WORD_OFFSET, 0xffffffffu);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_DRAW_DESCS_ADDR_OFFSET, drawDescAddr);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_DRAW_COUNT_OFFSET, 1u);
	const uint32_t rpuWords[] = {
		bmsx::VDP_RPU_PACKET_KIND | (bmsx::VDP_RPU_EXEC_PASS_LIST_WORDS << 16u), bmsx::VDP_RPU_OP_EXEC_PASS_LIST | (1u << 8u), passDescAddr,
		bmsx::VDP_RPU_PACKET_KIND | (bmsx::VDP_RPU_SEAL_FRAME_WORDS << 16u), bmsx::VDP_RPU_OP_SEAL_FRAME,
		bmsx::VDP_PKT_END,
	};
	for (const uint32_t word : rpuWords) {
		memory.writeMappedU32LE(bmsx::IO_VDP_FIFO, word);
	}
	memory.writeMappedU32LE(bmsx::IO_VDP_FIFO_CTRL, bmsx::VDP_FIFO_CTRL_SEAL);
	require(memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "restored VDP should accept RPU packets after libretro loadState");
	runtime.machine.vdp.advanceWork(runtime.machine.vdp.getPendingRenderWorkUnits());
	require(!runtime.machine.vdp.presentReadyFrameOnVblankEdge(), "RPU frame should not use legacy framebuffer presentation after libretro loadState");
	const bmsx::VdpDeviceOutput& output = runtime.machine.vdp.readDeviceOutput();
	require(output.rpu->commands.passCount == 1u, "restored runtime should publish retained RPU pass output");
	require(output.rpu->commands.drawCount == 1u, "restored runtime should publish retained RPU draw output");
	require(output.rpu->commands.passClearColor[0u] == 0xff112233u, "restored runtime should retain RPU clear constants");
}

void testInputInitializeInstallsBaseContext() {
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
	platform.setLogCallback(discardRetroLog);

	bmsx::Input& input = bmsx::Input::instance();
	bmsx::PlayerInput* const playerOne = input.getPlayerInput(bmsx::Input::DEFAULT_KEYBOARD_PLAYER_INDEX);
	platform.postKeyboardEvent("KeyX", true);
	input.pollInput();
	input.sampleInputControllerPlayers(0.0);

	require(playerOne->checkActionTriggered("a[p]"), "Input::initialize should install host defaults as the player base context");
	require(playerOne->getActionState("a").pressed, "default base context should map keyboard KeyX to action a");
}

} // namespace

int main() {
	testLibretroSaveStateRoundTrip();
	testInputInitializeInstallsBaseContext();
	return 0;
}
