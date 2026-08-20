#include "input.h"
#include "libretro_state.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/runtime.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/boot_rom_fixture.h"

#include <cstdint>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void discardInputPoll() {
}

bool supervisorRequestLineHigh = false;

bool RETRO_CALLCONV readSupervisorRequestLine() {
	return supervisorRequestLineHigh;
}

uint16_t gamepadState = 0u;

int16_t gamepadInputState(unsigned port, unsigned device, unsigned, unsigned id) {
	if (port == 0u && device == RETRO_DEVICE_JOYPAD) {
		return (gamepadState & (1u << id)) != 0u ? 1 : 0;
	}
	return 0;
}

void testLibretroStateEnvelopeRoundTrip() {
	bmsx::LibretroInput input(readSupervisorRequestLine);
	const std::vector<bmsx::u8> system =
		bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System);
	const std::vector<bmsx::u8> cartridge = bmsx::test::makeMinimalBootRom(
		bmsx::RomImageDomain::Cartridge,
		bmsx::CARTRIDGE_BOARD_RAM,
		16u);
	const bmsx::RomImage systemImage = bmsx::parseRomImage(
		system.data(),
		system.size(),
		bmsx::RomImageDomain::System);
	const bmsx::RomImage cartridgeImage = bmsx::parseRomImage(
		cartridge.data(),
		cartridge.size(),
		bmsx::RomImageDomain::Cartridge);
	const bmsx::CartridgeSlotMediaPair cartridgeMedia{{
		{
			cartridgeImage.bytes,
			cartridgeImage.header.cartridgeBoardWord,
			cartridgeImage.header.cartridgeRamByteCount,
			true,
		},
		{},
	}};
	bmsx::Runtime runtime(
		bmsx::RuntimeOptions{
			systemImage.bytes,
			cartridgeMedia,
			bmsx::PSX_MACHINE_SPEC,
		},
		input);
	runtime.resetForSystemBoot();
	runtime.boot();

	bmsx::Memory& memory = runtime.machine.memory;
	const size_t stateSize = bmsx::libretroStateSize(runtime);
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x11223344u);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0x89abcdefu);
	std::vector<bmsx::u8> envelope(stateSize + 16u);
	require(
		bmsx::serializeLibretroState(runtime, envelope),
		"libretro envelope should serialize into a caller buffer larger than its fixed size");
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0u);
	require(
		bmsx::unserializeLibretroState(runtime, envelope),
		"libretro envelope should decode its retained payload length");
	require(
		memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u,
		"libretro envelope should restore system RAM");
	require(
		memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0x89abcdefu,
		"libretro envelope should restore cartridge RAM");

	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	for (bmsx::u32 parameter = 0u; parameter < 2u; ++parameter) {
		gpu.writeGp0(0u);
	}
	gpu.onService(runtime.machine.scheduler.currentNowCycles() + 1);
	gpu.presentReadyFrameOnVblankEdge();
	require(
		bmsx::libretroStateSize(runtime) == stateSize,
		"libretro envelope size should remain fixed with maximum READY GPUREAD data");
	require(
		bmsx::serializeLibretroState(runtime, envelope),
		"libretro envelope should contain maximum READY GPUREAD data");
	require(
		bmsx::unserializeLibretroState(runtime, envelope),
		"libretro envelope should restore maximum READY GPUREAD data");
}

void testInputSnapshotReflectsHeldKey() {
	bmsx::LibretroInput input(readSupervisorRequestLine);
	input.postKeyboardEvent(RETROK_x, true);
	bmsx::InputControllerSnapshot snapshot;
	input.sampleInputControllerSnapshot(snapshot);

	constexpr uint32_t usage = 27u;
	require(
		(snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u,
		"raw ICU snapshot should set the keyboard bit for a held key");
}

void testLibretroSupervisorRequestChordAndGuestInput() {
	supervisorRequestLineHigh = false;
	bmsx::LibretroInput input(readSupervisorRequestLine);
	input.setInputPollCallback(discardInputPoll);
	input.setInputStateCallback(gamepadInputState);

	const uint32_t leftShoulderButton = 1u << static_cast<uint32_t>(
		bmsx::InputControllerGamepadButtonBit::LeftBumper);
	const uint32_t selectButton = 1u << static_cast<uint32_t>(
		bmsx::InputControllerGamepadButtonBit::Select);
	const uint32_t supervisorChordButtons = leftShoulderButton | selectButton;
	bmsx::InputControllerSnapshot snapshot;

	gamepadState = 1u << RETRO_DEVICE_ID_JOYPAD_L;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"a partial supervisor chord must remain ordinary gameplay");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[0].buttons & leftShoulderButton) != 0u,
		"a partial supervisor chord must remain cart-visible");

	gamepadState |= 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"a completed RetroPad supervisor chord must assert the host line");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[0].buttons & supervisorChordButtons) == 0u,
		"a completed supervisor chord must be masked from cart input");

	gamepadState = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"the supervisor chord must remain latched until full release");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[0].buttons & supervisorChordButtons) == 0u,
		"a latched supervisor chord must remain masked until full release");

	gamepadState = 0u;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"full chord release must lower and rearm the core-owned line");

	supervisorRequestLineHigh = true;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"the negotiated host line should assert the supervisor request");
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"a held host line should remain asserted");

	input.postKeyboardEvent(RETROK_F2, true);
	supervisorRequestLineHigh = false;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"a cart-visible F2 press must not assert the supervisor-request line");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::HID_USAGE_F2 >> 5u]
			& (1u << (bmsx::HID_USAGE_F2 & 31u))) != 0u,
		"libretro F2 must remain an ordinary cart-visible HID key");

	supervisorRequestLineHigh = true;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"the negotiated host line should remain independent of held guest keys");

	input.postKeyboardEvent(RETROK_F2, false);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::HID_USAGE_F2 >> 5u]
			& (1u << (bmsx::HID_USAGE_F2 & 31u))) == 0u,
		"releasing libretro F2 must clear its ordinary HID key");
	require(
		input.supervisorRequestLineHigh(),
		"guest key release must not lower the negotiated host line");
	supervisorRequestLineHigh = false;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"lowering the negotiated host line should deassert the supervisor request");
}

} // namespace

int main() {
	testLibretroStateEnvelopeRoundTrip();
	testInputSnapshotReflectsHeldKey();
	testLibretroSupervisorRequestChordAndGuestInput();
	return 0;
}
