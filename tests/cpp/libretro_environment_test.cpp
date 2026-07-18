#include "bmsx_libretro.h"
#include "input/manager.h"
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

void RETRO_CALLCONV discardLog(enum retro_log_level, const char*, ...) {
}

bool RETRO_CALLCONV testRequestLine() {
	requestLineReads += 1u;
	return true;
}

void discardVideo(const void*, unsigned, unsigned, size_t) {
}

void discardInputPoll() {
	inputPolls += 1u;
}

int16_t discardInputState(unsigned, unsigned, unsigned, unsigned) {
	return 0;
}

bool softwareFrontendEnvironment(unsigned command, void* data) {
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

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
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
	retro_init();
	require(retro_load_game(&game), "the core should load the minimal cart for supervisor negotiation validation");
	retro_run();
	require(inputPolls == 1u, "the supported core should poll the platform input owner once during the frame");
	require(requestLineReads == 1u, "an accepted frontend callback should drive the platform supervisor-request line");
	require(bmsx::Input::instance().supervisorRequestLineHigh(), "an accepted high frontend line must reach the machine input owner");
	retro_deinit();
	require(!bmsx::Input::instance().supervisorRequestLineHigh(), "core teardown should clear the machine supervisor-request line");

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
	retro_init();
	require(retro_load_game(&game), "the core should reload the minimal cart with the rejected supervisor interface");
	retro_run();
	require(inputPolls == 2u, "the rejected core should still poll the platform input owner once during the frame");
	require(requestLineReads == 1u, "a frontend callback written while rejecting the private command must never be retained");
	require(!bmsx::Input::instance().supervisorRequestLineHigh(), "a rejected private interface must leave the supervisor-request line low");
	retro_deinit();
	std::filesystem::remove_all(testDirectory);

	return 0;
}
