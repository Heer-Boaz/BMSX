#include "bmsx_libretro.h"
#include "common/endian.h"
#include "input/manager.h"
#include "spec/bmsx/cartridge.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/runtime/save_state/codec.h"
#include "support/boot_rom_fixture.h"

#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <vector>

namespace {

unsigned supervisorInterfaceQueries = 0u;
unsigned gxUploadProfileOffers = 0u;
bool defaultRequestLineWasLow = false;
bool gxUploadProfileReaderWasOffered = false;
bool acceptPrivateInterfaces = true;
bool acceptXrgb8888 = true;
unsigned pixelFormatRequests = 0u;
unsigned requestLineReads = 0u;
unsigned inputPolls = 0u;
unsigned geometryNotifications = 0u;
unsigned systemAvNotifications = 0u;
unsigned subsystemInfoOffers = 0u;
unsigned callbackSequence = 0u;
unsigned lastGeometryNotificationSequence = 0u;
unsigned lastSystemAvNotificationSequence = 0u;
unsigned lastVideoSequence = 0u;
bool environmentNotificationOutsideRun = false;
bool insideRetroRun = false;
bool lastVideoWasNull = false;
retro_game_geometry lastGeometry{};
retro_system_av_info lastSystemAvInfo{};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void RETRO_CALLCONV discardLog(enum retro_log_level, const char*, ...) {
}

bool RETRO_CALLCONV testRequestLine() {
	requestLineReads += 1u;
	return true;
}

void discardVideo(const void* data, unsigned, unsigned, size_t) {
	lastVideoWasNull = data == nullptr;
	lastVideoSequence = ++callbackSequence;
}

void discardInputPoll() {
	inputPolls += 1u;
}

int16_t discardInputState(unsigned, unsigned, unsigned, unsigned) {
	return 0;
}

bool softwareFrontendEnvironment(unsigned command, void* data) {
	if (command == RETRO_ENVIRONMENT_SET_PIXEL_FORMAT) {
		pixelFormatRequests += 1u;
		return acceptXrgb8888
			&& *static_cast<retro_pixel_format*>(data) == RETRO_PIXEL_FORMAT_XRGB8888;
	}
	if (command == RETRO_ENVIRONMENT_SET_GEOMETRY) {
		lastGeometry = *static_cast<retro_game_geometry*>(data);
		geometryNotifications += 1u;
		lastGeometryNotificationSequence = ++callbackSequence;
		environmentNotificationOutsideRun = environmentNotificationOutsideRun || !insideRetroRun;
		return true;
	}
	if (command == RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO) {
		lastSystemAvInfo = *static_cast<retro_system_av_info*>(data);
		systemAvNotifications += 1u;
		lastSystemAvNotificationSequence = ++callbackSequence;
		environmentNotificationOutsideRun = environmentNotificationOutsideRun || !insideRetroRun;
		return true;
	}
	if (command == RETRO_ENVIRONMENT_GET_LOG_INTERFACE) {
		static_cast<retro_log_callback*>(data)->log = discardLog;
		return true;
	}
	if (command == RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO) {
		const auto* subsystems = static_cast<const retro_subsystem_info*>(data);
		require(std::strcmp(subsystems[0].ident, "dualcart") == 0, "the core should register the dual-cartridge subsystem identifier");
		require(subsystems[0].id == BMSX_SUBSYSTEM_DUAL_CARTRIDGE, "the dual-cartridge subsystem should publish its stable public id");
		require(subsystems[0].num_roms == 2u, "the dual-cartridge subsystem should expose both physical sockets");
		require(subsystems[0].roms[0].required && !subsystems[0].roms[1].required, "slot 0 should be required while slot 1 remains optional");
		subsystemInfoOffers += 1u;
		return true;
	}
	if (command == RETRO_ENVIRONMENT_GET_VARIABLE) {
		auto& variable = *static_cast<retro_variable*>(data);
		if (std::strcmp(variable.key, "bmsx_render_backend") == 0) {
			variable.value = "software";
			return true;
		}
	}
	return false;
}

std::vector<bmsx::u8> makeExpandedPcrtcState(size_t cartridgeRamByteCount) {
	std::vector<bmsx::u8> envelope(retro_serialize_size());
	require(retro_serialize(envelope.data(), envelope.size()), "the core should serialize a state for libretro AV notification validation");
	const bmsx::u32 payloadBytes = bmsx::readLE32(envelope.data() + 4u);
	bmsx::RuntimeSaveState state = bmsx::decodeRuntimeSaveState(
		envelope.data() + 8u,
		payloadBytes,
		cartridgeRamByteCount);
	auto& pcrtc = state.machineState.machine.gxGpu.pcrtc;
	pcrtc.registerWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = 0x0000ff21u;
	pcrtc.presentWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = 0x0000ff21u;
	pcrtc.registerWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 0u;
	pcrtc.presentWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 0u;
	pcrtc.registerWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 1920u | (1080u << 12u);
	pcrtc.presentWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 1920u | (1080u << 12u);
	pcrtc.registerWords[bmsx::GX_GPU_PCRTC_SMODE1_LOW] = 0x40206504u;
	pcrtc.presentWords[bmsx::GX_GPU_PCRTC_SMODE1_LOW] = 0x40206504u;
	const std::vector<bmsx::u8> expandedPayload = bmsx::encodeRuntimeSaveState(state);
	bmsx::writeLE32(envelope.data() + 4u, static_cast<bmsx::u32>(expandedPayload.size()));
	std::memcpy(envelope.data() + 8u, expandedPayload.data(), expandedPayload.size());
	std::memset(envelope.data() + 8u + expandedPayload.size(), 0, envelope.size() - 8u - expandedPayload.size());
	return envelope;
}

bool frontendEnvironment(unsigned command, void* data) {
	if (command == BMSX_ENVIRONMENT_SET_GX_UPLOAD_PROFILE_INTERFACE_V1) {
		auto& interface = *static_cast<BmsxGxUploadProfileInterfaceV1*>(data);
		gxUploadProfileOffers += 1u;
		gxUploadProfileReaderWasOffered = interface.read_frame != nullptr;
		return acceptPrivateInterfaces;
	}
	if (command == BMSX_ENVIRONMENT_GET_SUPERVISOR_REQUEST_INTERFACE_V1) {
		auto& interface = *static_cast<BmsxSupervisorRequestInterfaceV1*>(data);
		supervisorInterfaceQueries += 1u;
		defaultRequestLineWasLow = !interface.request_line_high();
		interface.request_line_high = testRequestLine;
		return acceptPrivateInterfaces;
	}
	return softwareFrontendEnvironment(command, data);
}
} // namespace

int main() {
	constexpr bmsx::u32 primaryCartRamBytes = 16u;
	constexpr bmsx::u32 auxiliaryCartRamBytes = 24u;
	constexpr size_t cartridgeRamByteCount =
		static_cast<size_t>(primaryCartRamBytes) + auxiliaryCartRamBytes;
	const std::filesystem::path testDirectory =
		std::filesystem::temp_directory_path() / "bmsx_libretro_environment_test";
	std::filesystem::create_directories(testDirectory);
	const std::vector<bmsx::u8> system =
		bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System);
	std::ofstream systemRom(testDirectory / "bmsx-bios.rom", std::ios::binary);
	systemRom.write(
		reinterpret_cast<const char*>(system.data()),
		static_cast<std::streamsize>(system.size()));
	systemRom.close();
	const std::vector<bmsx::u8> cart =
		bmsx::test::makeMinimalDataRom(
			bmsx::CARTRIDGE_BOARD_RAM,
			primaryCartRamBytes);
	const std::vector<bmsx::u8> auxiliaryCart =
		bmsx::test::makeMinimalBootRom(
			bmsx::RomImageDomain::Cartridge,
			bmsx::CARTRIDGE_BOARD_RAM | bmsx::CARTRIDGE_BOARD_MAILBOX,
			auxiliaryCartRamBytes);
	const std::string gamePath = (testDirectory / "test.rom").string();
	const std::string auxiliaryPath = (testDirectory / "auxiliary.rom").string();
	std::ofstream gameRom(gamePath, std::ios::binary);
	gameRom.write(
		reinterpret_cast<const char*>(cart.data()),
		static_cast<std::streamsize>(cart.size()));
	gameRom.close();
	std::ofstream auxiliaryRom(auxiliaryPath, std::ios::binary);
	auxiliaryRom.write(
		reinterpret_cast<const char*>(auxiliaryCart.data()),
		static_cast<std::streamsize>(auxiliaryCart.size()));
	auxiliaryRom.close();
	const retro_game_info game{
		.path = gamePath.c_str(),
		.data = cart.data(),
		.size = cart.size(),
		.meta = nullptr,
	};
	retro_set_video_refresh(discardVideo);
	retro_set_input_poll(discardInputPoll);
	retro_set_input_state(discardInputState);

	retro_set_environment(frontendEnvironment);
	require(subsystemInfoOffers == 1u, "installing an environment should publish the cartridge subsystem once");
#if BMSX_ENABLE_GLES2
	require(gxUploadProfileOffers == 1u, "the core should offer the GX upload profile interface exactly once");
	require(gxUploadProfileReaderWasOffered, "the GX upload profile interface should contain a reader callback");
#else
	require(gxUploadProfileOffers == 0u, "a core without GLES2 must not offer its GX upload profile interface");
#endif
	require(supervisorInterfaceQueries == 1u, "the core should negotiate the private supervisor interface exactly once");
	require(defaultRequestLineWasLow, "the supervisor interface probe should start with a callable low line");
	retro_system_av_info initialAvInfo{};
	retro_get_system_av_info(&initialAvInfo);
	require(initialAvInfo.geometry.max_width == 1920u && initialAvInfo.geometry.max_height == 1080u, "libretro should advertise the standard PS2 output envelope");
	retro_set_environment(softwareFrontendEnvironment);
	retro_set_environment(frontendEnvironment);
	require(supervisorInterfaceQueries == 2u, "reinstalling the frontend environment should renegotiate the supervisor interface");
#if BMSX_ENABLE_GLES2
	require(gxUploadProfileOffers == 2u, "reinstalling the frontend environment should re-offer the GX upload profile interface");
#endif
	retro_init();
	const retro_game_info cartridgeSlots[2] = {
		{
			.path = gamePath.c_str(),
			.data = nullptr,
			.size = 0u,
			.meta = nullptr,
		},
		{
			.path = auxiliaryPath.c_str(),
			.data = nullptr,
			.size = 0u,
			.meta = nullptr,
		},
	};
	require(
		retro_load_game_special(BMSX_SUBSYSTEM_DUAL_CARTRIDGE, cartridgeSlots, 2u),
		"the core should load both physical cartridge sockets through the libretro subsystem");
	require(pixelFormatRequests == 1u, "content load should negotiate the XRGB8888 framebuffer contract once");
	std::vector<bmsx::u8> cartridgeState(retro_serialize_size());
	require(retro_serialize(cartridgeState.data(), cartridgeState.size()), "the dual-cartridge core should serialize both socket states");
	const bmsx::u32 cartridgeStateBytes = bmsx::readLE32(cartridgeState.data() + 4u);
	const bmsx::RuntimeSaveState cartridgeRuntimeState =
		bmsx::decodeRuntimeSaveState(
			cartridgeState.data() + 8u,
			cartridgeStateBytes,
			cartridgeRamByteCount);
	const auto& cartridgeControllerState = cartridgeRuntimeState.machineState.machine.cartridge;
	require(cartridgeControllerState.selectionWord == 0u, "the cartridge controller should reset to socket 0 without host-side executable inspection");
	require(cartridgeControllerState.slots[0].ram.size() == 16u, "slot 0 cartridge RAM should come from its physical cartridge header");
	require(cartridgeControllerState.slots[1].ram.size() == 24u, "slot 1 cartridge RAM should come from its physical cartridge header");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(inputPolls == 1u, "the supported core should poll the platform input owner once during the frame");
	require(requestLineReads == 1u, "an accepted frontend callback should drive the platform supervisor-request line");
	require(geometryNotifications == 0u && systemAvNotifications == 0u, "unchanged startup AV state should not be republished");

	const std::vector<bmsx::u8> expandedState = makeExpandedPcrtcState(cartridgeRamByteCount);
	require(retro_unserialize(expandedState.data(), expandedState.size()), "the core should restore the expanded PCRTC state");
	require(geometryNotifications == 0u && systemAvNotifications == 0u, "retro_unserialize must not call libretro video environment commands");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(systemAvNotifications == 1u && geometryNotifications == 0u, "raw output beyond the current envelope should publish one system AV update");
	require(lastSystemAvInfo.geometry.base_width == 1921u && lastSystemAvInfo.geometry.base_height == 1081u, "the system AV update should publish restored raw PCRTC geometry");
	require(lastSystemAvInfo.geometry.max_width == 1921u && lastSystemAvInfo.geometry.max_height == 1081u, "the system AV update should expand the libretro output envelope");
	require(lastSystemAvNotificationSequence < lastVideoSequence, "the frontend must receive an expanded AV envelope before the software frame");
	require(!lastVideoWasNull, "a software frame remains valid after a synchronous system AV update");

	const unsigned notificationsBeforeReset = geometryNotifications + systemAvNotifications;
	retro_reset();
	require(geometryNotifications + systemAvNotifications == notificationsBeforeReset, "retro_reset must defer geometry publication to retro_run");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(geometryNotifications == 1u, "retro_run should publish the reset geometry queued outside the frame");
	require(lastGeometry.base_width == 320u && lastGeometry.base_height == 240u, "the reset geometry notification should expose the GPU reset output");
	require(lastGeometryNotificationSequence < lastVideoSequence, "queued reset geometry should be published before the next frame");

	const unsigned notificationsBeforeRestore = geometryNotifications + systemAvNotifications;
	require(retro_unserialize(expandedState.data(), expandedState.size()), "the core should restore expanded PCRTC output after reset");
	require(geometryNotifications + systemAvNotifications == notificationsBeforeRestore, "save-state restore must keep frontend notification work pending until retro_run");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(geometryNotifications == 2u && systemAvNotifications == 1u, "restored geometry inside the current envelope should use one geometry notification");
	require(lastGeometry.base_width == 1921u && lastGeometry.base_height == 1081u, "the restored geometry notification should expose raw PCRTC output");
	require(lastGeometryNotificationSequence < lastVideoSequence, "restored geometry should reach the frontend before its software frame");
	require(!environmentNotificationOutsideRun, "libretro video environment notifications must only occur inside retro_run");
	retro_deinit();

	inputPolls = 0u;
	requestLineReads = 0u;
	defaultRequestLineWasLow = false;
	gxUploadProfileReaderWasOffered = false;
	acceptPrivateInterfaces = false;
	retro_set_environment(frontendEnvironment);
#if BMSX_ENABLE_GLES2
	require(gxUploadProfileOffers == 3u, "a replacement frontend should receive one fresh GX upload profile offer");
	require(gxUploadProfileReaderWasOffered, "a rejected GX upload profile offer should still carry the core reader");
#else
	require(gxUploadProfileOffers == 0u, "a replacement frontend must not receive an unavailable GX upload profile interface");
#endif
	require(supervisorInterfaceQueries == 3u, "a replacement frontend should receive one fresh supervisor interface probe");
	require(defaultRequestLineWasLow, "an unsupported frontend should inherit a fresh callable low line");
	retro_get_system_av_info(&initialAvInfo);
	retro_init();
	require(retro_load_game(&game), "the core should reload the minimal cart with the rejected supervisor interface");
	require(pixelFormatRequests == 2u, "replacement content load should renegotiate the XRGB8888 framebuffer contract once");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(inputPolls == 1u, "the rejected core should still poll the platform input owner once during the frame");
	require(requestLineReads == 0u, "a frontend callback written while rejecting the private command must never be retained");
	retro_deinit();

	acceptXrgb8888 = false;
	retro_set_environment(frontendEnvironment);
	retro_get_system_av_info(&initialAvInfo);
	retro_init();
	require(!retro_load_game(&game), "the core must reject a frontend that cannot consume its XRGB8888 framebuffer");
	require(pixelFormatRequests == 3u, "an unsupported frontend should receive one XRGB8888 negotiation request");
	retro_deinit();
	std::filesystem::remove_all(testDirectory);

	return 0;
}
