#include "bmsx_libretro.h"
#include "common/endian.h"
#include "input/manager.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/runtime/save_state/codec.h"
#include "support/program_rom_fixture.h"

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
unsigned requestLineReads = 0u;
unsigned inputPolls = 0u;
unsigned geometryNotifications = 0u;
unsigned systemAvNotifications = 0u;
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
	if (command == RETRO_ENVIRONMENT_GET_VARIABLE) {
		auto& variable = *static_cast<retro_variable*>(data);
		if (std::strcmp(variable.key, "bmsx_render_backend") == 0) {
			variable.value = "software";
			return true;
		}
	}
	return false;
}

std::vector<bmsx::u8> makeExpandedPcrtcState() {
	std::vector<bmsx::u8> envelope(retro_serialize_size());
	require(retro_serialize(envelope.data(), envelope.size()), "the core should serialize a state for libretro AV notification validation");
	const bmsx::u32 payloadBytes = bmsx::readLE32(envelope.data() + 4u);
	bmsx::RuntimeSaveState state = bmsx::decodeRuntimeSaveState(envelope.data() + 8u, payloadBytes);
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
	const std::filesystem::path testDirectory =
		std::filesystem::temp_directory_path() / "bmsx_libretro_environment_test";
	std::filesystem::create_directories(testDirectory);
	const std::vector<bmsx::u8> system =
		bmsx::test::makeMinimalProgramRom(bmsx::ProgramBootTarget::System);
	std::ofstream systemRom(testDirectory / "bmsx-bios.rom", std::ios::binary);
	systemRom.write(
		reinterpret_cast<const char*>(system.data()),
		static_cast<std::streamsize>(system.size()));
	systemRom.close();
	const std::vector<bmsx::u8> cart =
		bmsx::test::makeMinimalProgramRom(bmsx::ProgramBootTarget::Cart);
	const std::string gamePath = (testDirectory / "test.rom").string();
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
	retro_init();
	require(retro_load_game(&game), "the core should load the minimal cart for supervisor negotiation validation");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(inputPolls == 1u, "the supported core should poll the platform input owner once during the frame");
	require(requestLineReads == 1u, "an accepted frontend callback should drive the platform supervisor-request line");
	require(bmsx::Input::instance().supervisorRequestLineHigh(), "an accepted high frontend line must reach the machine input owner");
	require(geometryNotifications == 0u && systemAvNotifications == 0u, "unchanged startup AV state should not be republished");

	const std::vector<bmsx::u8> expandedState = makeExpandedPcrtcState();
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
	require(!bmsx::Input::instance().supervisorRequestLineHigh(), "core teardown should clear the machine supervisor-request line");

	inputPolls = 0u;
	requestLineReads = 0u;
	defaultRequestLineWasLow = false;
	gxUploadProfileReaderWasOffered = false;
	acceptPrivateInterfaces = false;
	retro_set_environment(frontendEnvironment);
#if BMSX_ENABLE_GLES2
	require(gxUploadProfileOffers == 2u, "a replacement frontend should receive one fresh GX upload profile offer");
	require(gxUploadProfileReaderWasOffered, "a rejected GX upload profile offer should still carry the core reader");
#else
	require(gxUploadProfileOffers == 0u, "a replacement frontend must not receive an unavailable GX upload profile interface");
#endif
	require(supervisorInterfaceQueries == 2u, "a replacement frontend should receive one fresh supervisor interface probe");
	require(defaultRequestLineWasLow, "an unsupported frontend should inherit a fresh callable low line");
	retro_get_system_av_info(&initialAvInfo);
	retro_init();
	require(retro_load_game(&game), "the core should reload the minimal cart with the rejected supervisor interface");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(inputPolls == 1u, "the rejected core should still poll the platform input owner once during the frame");
	require(requestLineReads == 0u, "a frontend callback written while rejecting the private command must never be retained");
	require(!bmsx::Input::instance().supervisorRequestLineHigh(), "a rejected private interface must leave the supervisor-request line low");
	retro_deinit();
	std::filesystem::remove_all(testDirectory);

	return 0;
}
