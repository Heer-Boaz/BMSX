#include "bmsx_libretro.h"
#include "input.h"
#include "libretro_state.h"
#include "runtime_error.h"
#include "video_output.h"
#include "common/endian.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/io.h"
#include "spec/gx/pcrtc.h"
#include "spec/blua32/opcode.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "spec/bmsx/model.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/runtime/runtime.h"
#include "support/blua32_test_rom.h"
#include "support/boot_rom_fixture.h"

#include <array>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

unsigned supervisorInterfaceQueries = 0u;
bool defaultRequestLineWasLow = false;
bool acceptPrivateInterfaces = true;
unsigned nativeProfileOffers = 0u;
BmsxNativeCompilationProfileInterfaceV2 nativeProfile{};
unsigned executionProfileOffers = 0u;
BmsxExecutionProfileInterface executionProfile{};
unsigned runCadenceOffers = 0u;
BmsxRunCadenceV1* runCadence = nullptr;
BmsxGuestProgressInterfaceV1 guestProgress{};
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
std::string systemDirectory;
std::vector<std::string> diagnosticLines;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void RETRO_CALLCONV discardLog(enum retro_log_level, const char*, ...) {
}

void RETRO_CALLCONV captureDiagnosticLog(enum retro_log_level level, const char* format, ...) {
	require(level == RETRO_LOG_INFO, "diagnostic output uses the info log level");
	std::array<char, bmsx::SYS_PRINT_BUFFER_BYTES * 2u + 2u> bytes;
	va_list args;
	va_start(args, format);
	const int count = std::vsnprintf(bytes.data(), bytes.size(), format, args);
	va_end(args);
	require(count >= 0 && static_cast<size_t>(count) < bytes.size(), "diagnostic line fits the log capture");
	diagnosticLines.emplace_back(bytes.data(), static_cast<size_t>(count));
}

bool RETRO_CALLCONV testRequestLine() {
	requestLineReads += 1u;
	return true;
}

void testDiagnosticTextLog() {
	bmsx::LibretroInput input(testRequestLine);
	bmsx::Runtime runtime({{}, {}, bmsx::PSX_MACHINE_SPEC}, input);
	auto& memory = runtime.machine.memory;
	const retro_log_callback logging{captureDiagnosticLog};
	for (const bmsx::u32 value : {0xfeffu, 0x41u, 0u, 0x42u, 0x25u, 0x20acu}) {
		memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, value);
	}
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 0u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	for (const bmsx::u32 value : {0xfeffu, 0x43u, 0x10ffffu}) memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, value);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 0u);
	bmsx::flushLibretroSystemOutput(runtime, logging);
	require(diagnosticLines == std::vector<std::string>{"\xef\xbb\xbf" "A\\0B%\xe2\x82\xac\n", "\n", "\xef\xbb\xbf" "C\xf4\x8f\xbf\xbf\n"},
		"diagnostic log preserves Unicode and empty lines, renders NUL, and terminates every line");
	require(runtime.machine.systemDebugTransmit.availableByteCount() == 0u, "diagnostic log drains complete bytes");
	bmsx::flushLibretroSystemOutput(runtime, logging);
	require(diagnosticLines.size() == 3u, "drained diagnostic lines are not repeated");
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x78u);
	bmsx::flushLibretroSystemOutput(runtime, logging);
	require(diagnosticLines.size() == 3u, "partial diagnostic lines remain in the device");
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 0u);
	bmsx::flushLibretroSystemOutput(runtime, logging);
	require(diagnosticLines.back() == "x\n", "a later flush publishes the partial line once");
	for (bmsx::u32 index = 0u; index < bmsx::SYS_PRINT_BUFFER_BYTES - 1u; ++index) {
		memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0u);
	}
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 0u);
	bmsx::flushLibretroSystemOutput(runtime, logging);
	std::string expanded;
	for (bmsx::u32 index = 0u; index < bmsx::SYS_PRINT_BUFFER_BYTES - 1u; ++index) expanded += "\\0";
	require(diagnosticLines.back() == expanded + '\n', "a full diagnostic line fits even when every codepoint is NUL");
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
	if (command == BMSX_ENVIRONMENT_SET_RUN_CADENCE_V1) {
		++runCadenceOffers;
		if (acceptPrivateInterfaces) runCadence = static_cast<BmsxRunCadenceV1*>(data);
		else static_cast<BmsxRunCadenceV1*>(data)->retain_frame_grant = true;
		return acceptPrivateInterfaces;
	}
	if (command == BMSX_ENVIRONMENT_SET_GUEST_PROGRESS_INTERFACE_V1) {
		guestProgress = *static_cast<BmsxGuestProgressInterfaceV1*>(data);
		return true;
	}
	if (command == BMSX_ENVIRONMENT_SET_EXECUTION_PROFILE_INTERFACE) {
		++executionProfileOffers;
		if (acceptPrivateInterfaces) executionProfile = *static_cast<BmsxExecutionProfileInterface*>(data);
		return acceptPrivateInterfaces;
	}
	if (command == BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE_V2) {
		++nativeProfileOffers;
		if (acceptPrivateInterfaces) nativeProfile = *static_cast<BmsxNativeCompilationProfileInterfaceV2*>(data);
		return acceptPrivateInterfaces;
	}
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
	if (command == RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY) {
		*static_cast<const char**>(data) = systemDirectory.c_str();
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

std::vector<bmsx::u8> makeExpandedPcrtcState() {
	std::vector<bmsx::u8> envelope(retro_serialize_size());
	require(retro_serialize(envelope.data(), envelope.size()), "the core should serialize a state for libretro AV notification validation");
	const bmsx::u32 payloadBytes = bmsx::readLE32(envelope.data() + 4u);
	bmsx::RuntimeSaveState state = bmsx::decodeRuntimeSaveState(
		std::span<const bmsx::u8>(envelope.data() + bmsx::LIBRETRO_STATE_HEADER_BYTES, payloadBytes),
		bmsx::PSX_MACHINE_SPEC.ramBytes,
		bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
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
	auto payload = std::span(envelope).subspan(bmsx::LIBRETRO_STATE_HEADER_BYTES);
	std::memcpy(payload.data(), expandedPayload.data(), expandedPayload.size());
	std::memset(payload.data() + expandedPayload.size(), 0, payload.size() - expandedPayload.size());
	return envelope;
}

bool frontendEnvironment(unsigned command, void* data) {
	if (command == BMSX_ENVIRONMENT_GET_SUPERVISOR_REQUEST_INTERFACE_V1) {
		auto& interface = *static_cast<BmsxSupervisorRequestInterfaceV1*>(data);
		supervisorInterfaceQueries += 1u;
		defaultRequestLineWasLow = !interface.request_line_high();
		interface.request_line_high = testRequestLine;
		return acceptPrivateInterfaces;
	}
	return softwareFrontendEnvironment(command, data);
}

void testAvPublicationPhases() {
	static unsigned geometry = 0u, system = 0u;
	static bool presenting = false;
	bmsx::LibretroVideoOutput output;
	output.setEnvironment([](unsigned command, void*) -> bool {
		if (command == RETRO_ENVIRONMENT_SET_GEOMETRY) ++geometry;
		if (command == RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO) {
			require(!presenting, "a system AV notification cannot recreate GL during presentation");
			++system;
		}
		return true;
	});
	retro_system_av_info initial{};
	output.getSystemAvInfo(initial);
	output.stageDisplaySize(256, 192, 256, 192);
	require(geometry == 0u && system == 0u, "staging outside retro_run does not publish AV parameters");
	require(output.publishPendingAvInfo() == bmsx::LibretroAvInfoNotification::Geometry,
		"the safe frame-entry boundary publishes staged geometry");
	presenting = true;
	output.setDisplaySize(320, 240, 320, 240);
	require(geometry == 2u && system == 0u, "in-envelope presentation geometry is published immediately");
	output.setDisplaySize(1921, 1081, 1921, 1081);
	require(geometry == 2u && system == 0u, "an expanded envelope stays pending during presentation");
	presenting = false;
	require(output.publishPendingAvInfo() == bmsx::LibretroAvInfoNotification::System && system == 1u,
		"the safe frame-exit boundary publishes the expanded envelope");
	output.setFrameRate(bmsx::GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED + 1);
	presenting = true;
	output.setDisplaySize(256, 192, 256, 192);
	require(geometry == 2u && system == 1u, "a pending timing change prevents an intermediate geometry notification");
	presenting = false;
	require(output.publishPendingAvInfo() == bmsx::LibretroAvInfoNotification::System && system == 2u,
		"timing and geometry changes share a safe system AV publication");
}

void testStateRequiresInstalledMedia(const std::filesystem::path& testDirectory) {
	using namespace bmsx;
	const auto stock = testDirectory / "original";
	const auto other = testDirectory / "other";
	std::filesystem::create_directories(stock);
	std::filesystem::create_directories(other);
	const CartManifest hardware{.title = std::nullopt, .hardware = {
		CartridgeRomDeviceConfig{}, CartridgeRamDeviceConfig{16u}, CartridgeMailboxDeviceConfig{},
	}};
	const auto writeImage = [](const std::filesystem::path& path, RomImageDomain domain, OpCode load,
		const CartManifest& manifest) {
		test::Blua32TestImage code;
		code.text.resize(2u * INSTRUCTION_BYTES);
		writeInstruction(code.text, 0u, static_cast<u8>(load), 0u, 0u, 0u);
		writeInstruction(code.text, 1u, static_cast<u8>(OpCode::HALT), 0u, 0u, 0u);
		code.functions = {{.firstWord = 0u, .wordCount = 2u}};
		const auto image = test::encodeBlua32TestRom(domain, code, manifest);
		std::ofstream file(path, std::ios::binary);
		file.write(reinterpret_cast<const char*>(image.bytes.data()), static_cast<std::streamsize>(image.bytes.size()));
		return image.bytes.size();
	};
	const auto bios = stock / "bmsx-bios.rom";
	const auto otherBios = other / "bmsx-bios.rom";
	const size_t biosBytes = writeImage(bios, RomImageDomain::System, OpCode::K0, {});
	require(writeImage(otherBios, RomImageDomain::System, OpCode::K1, {}) == biosBytes,
		"both BIOS files have the same installed extent");
	const auto first = stock / "first.rom";
	const auto second = stock / "second.rom";
	const size_t cartBytes = writeImage(first, RomImageDomain::Cartridge, OpCode::K0, hardware);
	require(writeImage(second, RomImageDomain::Cartridge, OpCode::K1, hardware) == cartBytes,
		"both physical cartridges have the same ROM extent and device layout");

	const auto load = [](const std::filesystem::path& firmware, const std::filesystem::path& slot0,
		const std::filesystem::path& slot1) {
		systemDirectory = firmware.string();
		retro_init();
		const std::string path0 = slot0.string(), path1 = slot1.string();
		const retro_game_info slots[] = {
			{path0.c_str(), nullptr, 0u, nullptr}, {path1.c_str(), nullptr, 0u, nullptr},
		};
		require(retro_load_game_special(BMSX_SUBSYSTEM_DUAL_CARTRIDGE, slots, std::size(slots)),
			"the frontend admits both valid cartridge configurations");
	};
	load(stock, first, second);
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	std::vector<u8> saved(retro_serialize_size()), before(saved.size()), after(saved.size());
	require(retro_serialize(saved.data(), saved.size()), "capture an ordinary running machine");
	BmsxGuestProgressV1 savedProgress{};
	guestProgress.read_progress(&savedProgress);
	require(savedProgress.scheduler_cycles > 0, "the saved state is not the initial boot state");
	retro_deinit();

	const auto rejectsWithoutMutation = [&](const char* message) {
		require(retro_serialize_size() == saved.size(), "same hardware has the same envelope capacity");
		require(retro_serialize(before.data(), before.size()), "capture the current boot state");
		require(!retro_unserialize(saved.data(), saved.size()), message);
		require(retro_serialize(after.data(), after.size()) && after == before,
			"a wrong-media restore leaves the running machine unchanged");
		retro_deinit();
	};
	load(other, first, second);
	rejectsWithoutMutation("identical cartridges cannot load a state from different BIOS bytes");
	load(stock, second, first);
	rejectsWithoutMutation("the same pair of cartridges cannot load a state from reversed sockets");

	std::filesystem::copy_file(bios, otherBios, std::filesystem::copy_options::overwrite_existing);
	std::filesystem::copy_file(first, other / "first-copy.rom", std::filesystem::copy_options::overwrite_existing);
	std::filesystem::copy_file(second, other / "second-copy.rom", std::filesystem::copy_options::overwrite_existing);
	load(other, other / "first-copy.rom", other / "second-copy.rom");
	retro_reset();
	require(retro_unserialize(saved.data(), saved.size()), "identical bytes load through different paths after reset");
	BmsxGuestProgressV1 restored{};
	guestProgress.read_progress(&restored);
	require(restored.scheduler_cycles == savedProgress.scheduler_cycles
		&& restored.tick_sequence == savedProgress.tick_sequence, "the same-media restore reinstates saved guest progress");
	retro_deinit();
}
} // namespace

int main() {
	testAvPublicationPhases();
	testDiagnosticTextLog();
	constexpr bmsx::u32 primaryCartRamBytes = 16u;
	constexpr bmsx::u32 auxiliaryCartRamBytes = 24u;
	const std::filesystem::path testDirectory =
		std::filesystem::temp_directory_path() / "bmsx_libretro_environment_test";
	std::filesystem::create_directories(testDirectory);
	systemDirectory = testDirectory.string();
	const std::vector<bmsx::u8> system =
		bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System);
	std::ofstream systemRom(testDirectory / "bmsx-bios.rom", std::ios::binary);
	systemRom.write(
		reinterpret_cast<const char*>(system.data()),
		static_cast<std::streamsize>(system.size()));
	systemRom.close();
	bmsx::CartManifest primaryCartManifest;
	primaryCartManifest.hardware.emplace_back(
		bmsx::CartridgeRamDeviceConfig{primaryCartRamBytes});
	const std::vector<bmsx::u8> cart =
		bmsx::test::makeMinimalDataRom(primaryCartManifest);
	bmsx::CartManifest auxiliaryCartManifest;
	auxiliaryCartManifest.hardware.emplace_back(
		bmsx::CartridgeRomDeviceConfig{});
	auxiliaryCartManifest.hardware.emplace_back(
		bmsx::CartridgeRamDeviceConfig{auxiliaryCartRamBytes});
	auxiliaryCartManifest.hardware.emplace_back(
		bmsx::CartridgeMailboxDeviceConfig{});
	const std::vector<bmsx::u8> auxiliaryCart =
		bmsx::test::makeMinimalBootRom(
			bmsx::RomImageDomain::Cartridge,
			auxiliaryCartManifest);
	const std::string gamePath = (testDirectory / "test.rom").string();
	const std::string auxiliaryPath = (testDirectory / "auxiliary.rom").string();
	const std::string malformedPath = (testDirectory / "malformed.rom").string();
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
	std::ofstream malformedRom(malformedPath, std::ios::binary);
	constexpr char malformedPackage[] = "not-a-cartridge-package";
	malformedRom.write(malformedPackage, sizeof(malformedPackage) - 1u);
	malformedRom.close();
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
	require(runCadenceOffers == 1u && runCadence != nullptr
		&& !runCadence->retain_frame_grant && !runCadence->maintenance_only,
		"an accepting frontend receives a private slot without initially lending a grant");
	require(supervisorInterfaceQueries == 1u, "the core should negotiate the private supervisor interface exactly once");
	require(defaultRequestLineWasLow, "the supervisor interface probe should start with a callable low line");
	retro_system_av_info initialAvInfo{};
	retro_get_system_av_info(&initialAvInfo);
	require(initialAvInfo.geometry.max_width == 1920u && initialAvInfo.geometry.max_height == 1080u, "libretro should advertise the standard PS2 output envelope");
	retro_set_environment(softwareFrontendEnvironment);
	retro_set_environment(frontendEnvironment);
	require(supervisorInterfaceQueries == 2u, "reinstalling the frontend environment should renegotiate the supervisor interface");
	retro_init();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(executionProfileOffers == 1u && executionProfile.read_profile != nullptr,
		"diagnostic cores offer the opt-in execution profile during initialization");
#else
	require(executionProfileOffers == 0u, "standard cores do not offer execution diagnostics");
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(nativeProfileOffers == 1u && nativeProfile.read_profile != nullptr,
		"native core offers the opt-in cumulative compilation profile during initialization");
#else
	require(nativeProfileOffers == 0u, "interpreter-only core does not offer native compilation profiling");
#endif
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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	BmsxNativeCompilationProfileV2 initialNativeProfile{};
	nativeProfile.read_profile(&initialNativeProfile);
	require(initialNativeProfile.counters.prepare_requests == 0u && initialNativeProfile.counters.prepare_nanoseconds == 0u
		&& initialNativeProfile.background_completed == 0u && initialNativeProfile.background_cancelled == 0u
		&& initialNativeProfile.background_nanoseconds == 0u,
		"accepted native profile reads the loaded CPU before guest execution");
#endif
	std::vector<bmsx::u8> cartridgeState(retro_serialize_size());
	require(retro_serialize(cartridgeState.data(), cartridgeState.size()), "the dual-cartridge core should serialize both socket states");
	const bmsx::u32 cartridgeStateBytes = bmsx::readLE32(cartridgeState.data() + 4u);
	const bmsx::RuntimeSaveState cartridgeRuntimeState =
		bmsx::decodeRuntimeSaveState(
			std::span<const bmsx::u8>(
				cartridgeState.data() + bmsx::LIBRETRO_STATE_HEADER_BYTES,
				cartridgeStateBytes
			),
			bmsx::PSX_MACHINE_SPEC.ramBytes,
			bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	const auto& cartridgeControllerState = cartridgeRuntimeState.machineState.machine.cartridge;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	BmsxExecutionProfile initialExecutionProfile{}, repeatedExecutionProfile{};
	executionProfile.read_profile(&initialExecutionProfile);
	executionProfile.read_profile(&repeatedExecutionProfile);
	require(std::memcmp(&initialExecutionProfile, &repeatedExecutionProfile, sizeof(initialExecutionProfile)) == 0,
		"repeated diagnostic reads neither execute guest work nor consume diagnostic counters");
	require(initialExecutionProfile.scheduler_now_cycles == cartridgeRuntimeState.machineState.schedulerNowCycles
		&& initialExecutionProfile.cpu_slice_count == 0u && initialExecutionProfile.cpu_slice_consumed_cycles == 0,
		"execution profile exports the raw scheduler position and unexecuted CPU slice counters");
	require(initialExecutionProfile.gc_collections == 1u,
		"the loaded CPU profile includes its boot collection before the first host run");
	require(initialExecutionProfile.gc_total_nanoseconds >= initialExecutionProfile.gc_roots_nanoseconds
		+ initialExecutionProfile.gc_trace_nanoseconds + initialExecutionProfile.gc_weak_nanoseconds
		+ initialExecutionProfile.gc_sweep_nanoseconds + initialExecutionProfile.gc_string_reclaim_nanoseconds
		+ initialExecutionProfile.gc_mark_again_nanoseconds,
		"GC phase times are contained within the complete collection interval");
	std::vector<bmsx::u8> afterProfileReads(cartridgeState.size());
	require(retro_serialize(afterProfileReads.data(), afterProfileReads.size()) && afterProfileReads == cartridgeState,
		"profile reads leave serialized machine state unchanged");
	bmsx::RuntimeSaveState negativeSchedulerState = cartridgeRuntimeState;
	negativeSchedulerState.machineState.schedulerNowCycles = -INT64_C(9007199254740993);
	const auto negativePayload = bmsx::encodeRuntimeSaveState(negativeSchedulerState);
	std::vector<bmsx::u8> negativeEnvelope(cartridgeState.size());
	std::memcpy(negativeEnvelope.data(), cartridgeState.data(), bmsx::LIBRETRO_STATE_HEADER_BYTES);
	bmsx::writeLE32(negativeEnvelope.data() + 4u, static_cast<bmsx::u32>(negativePayload.size()));
	std::memcpy(negativeEnvelope.data() + bmsx::LIBRETRO_STATE_HEADER_BYTES, negativePayload.data(), negativePayload.size());
	require(retro_unserialize(negativeEnvelope.data(), negativeEnvelope.size()),
		"a signed scheduler position can be restored through the existing state interface");
	executionProfile.read_profile(&repeatedExecutionProfile);
	require(repeatedExecutionProfile.scheduler_now_cycles == negativeSchedulerState.machineState.schedulerNowCycles,
		"execution profile preserves a raw negative scheduler position without clamping or number conversion");
	repeatedExecutionProfile.scheduler_now_cycles = initialExecutionProfile.scheduler_now_cycles;
	require(std::memcmp(&initialExecutionProfile, &repeatedExecutionProfile, sizeof(initialExecutionProfile)) == 0,
		"state restoration does not rewind or regenerate CPU-lifetime diagnostic counters");
	require(retro_unserialize(cartridgeState.data(), cartridgeState.size()), "restore the startup machine before its first host run");
#endif
	require(cartridgeControllerState.selectionWord == 0u, "the cartridge controller should reset to socket 0 without host-side executable inspection");
	require(cartridgeControllerState.slots[0]->ram->size() == 16u, "slot 0 cartridge RAM should come from its physical cartridge manifest");
	require(cartridgeControllerState.slots[1]->ram->size() == 24u, "slot 1 cartridge RAM should come from its physical cartridge manifest");
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	require(inputPolls == 1u, "the supported core should poll the platform input owner once during the frame");
	require(requestLineReads == 1u, "an accepted frontend callback should drive the platform supervisor-request line");
	require(geometryNotifications == 0u && systemAvNotifications == 0u, "unchanged startup AV state should not be republished");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	BmsxExecutionProfile runningExecutionProfile{};
	executionProfile.read_profile(&runningExecutionProfile);
	require(runningExecutionProfile.cpu_native_origin_cycles + runningExecutionProfile.cpu_interpreter_runtime_cycles
		== runningExecutionProfile.cpu_slice_consumed_cycles,
		"the backend partition equals the existing exact CPU grant consumption");
	require(runningExecutionProfile.scheduler_now_cycles > initialExecutionProfile.scheduler_now_cycles
		&& runningExecutionProfile.cpu_slice_count > 0u
		&& runningExecutionProfile.cpu_slice_consumed_cycles == static_cast<int64_t>(runningExecutionProfile.cpu_slice_count)
			* bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::HALT)],
		"boot and supervisor entries contain only HALT, so each recorded CPU slice charges exactly that instruction's cost");
	require(runningExecutionProfile.gc_collections == initialExecutionProfile.gc_collections,
		"a nonallocating boot HALT does not fabricate a guest collection");
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	BmsxNativeCompilationProfileV2 runningNativeProfile{};
	nativeProfile.read_profile(&runningNativeProfile);
	require(runningNativeProfile.counters.prepare_nanoseconds == runningNativeProfile.counters.discovery_nanoseconds
		+ runningNativeProfile.counters.retirement_nanoseconds + runningNativeProfile.counters.compilation_nanoseconds
		&& runningNativeProfile.counters.peak_code_bytes >= runningNativeProfile.counters.code_bytes,
		"private profile readout preserves the owning CPU phase totals and absolute cache gauges");
#endif

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
	require(!runCadence->maintenance_only, "ordinary AV updates do not claim a maintenance slot");

	const unsigned notificationsBeforeReset = geometryNotifications + systemAvNotifications;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	BmsxExecutionProfile beforeResetProfile{}, afterResetProfile{};
	executionProfile.read_profile(&beforeResetProfile);
#endif
	retro_reset();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	executionProfile.read_profile(&afterResetProfile);
	require(afterResetProfile.scheduler_now_cycles == 0
		&& afterResetProfile.cpu_slice_count == beforeResetProfile.cpu_slice_count
		&& afterResetProfile.cpu_slice_consumed_cycles == beforeResetProfile.cpu_slice_consumed_cycles,
		"hardware reset rewinds scheduler position without resetting diagnostic CPU consumption");
	require(afterResetProfile.cpu_native_origin_cycles == beforeResetProfile.cpu_native_origin_cycles
		&& afterResetProfile.cpu_interpreter_runtime_cycles == beforeResetProfile.cpu_interpreter_runtime_cycles,
		"hardware reset does not rewind backend-origin diagnostic lifetime counters");
	require(afterResetProfile.gc_collections == beforeResetProfile.gc_collections + 1u
		&& afterResetProfile.gc_total_nanoseconds >= beforeResetProfile.gc_total_nanoseconds,
		"CPU reset adds its real collection to the existing diagnostic lifetime");
#endif
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
	acceptPrivateInterfaces = false;
	runCadence = nullptr;
	retro_set_environment(frontendEnvironment);
	require(supervisorInterfaceQueries == 3u, "a replacement frontend should receive one fresh supervisor interface probe");
	require(defaultRequestLineWasLow, "an unsupported frontend should inherit a fresh callable low line");
	retro_get_system_av_info(&initialAvInfo);
	retro_init();
	require(retro_load_game(&game), "the core should reload the minimal cart with the rejected supervisor interface");
	require(pixelFormatRequests == 2u, "replacement content load should renegotiate the XRGB8888 framebuffer contract once");
	const unsigned videoBeforeRejectedRun = lastVideoSequence;
	BmsxGuestProgressV1 positionBeforeRejectedRun{}, positionAfterRejectedRun{};
	guestProgress.read_progress(&positionBeforeRejectedRun);
	insideRetroRun = true;
	retro_run();
	insideRetroRun = false;
	guestProgress.read_progress(&positionAfterRejectedRun);
	require(runCadence == nullptr && lastVideoSequence > videoBeforeRejectedRun
		&& positionAfterRejectedRun.scheduler_cycles > positionBeforeRejectedRun.scheduler_cycles,
		"a frontend rejecting the cadence handshake still gets standard video and a new guest grant");
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

	acceptXrgb8888 = true;
	retro_set_environment(frontendEnvironment);
	retro_get_system_av_info(&initialAvInfo);
	retro_init();
	const retro_game_info malformedGame{
		.path = malformedPath.c_str(),
		.data = nullptr,
		.size = 0u,
		.meta = nullptr,
	};
	require(
		!retro_load_game(&malformedGame),
		"invalid cartridge package data must fail admission without crossing the libretro ABI"
	);
	require(pixelFormatRequests == 4u, "malformed content should pass through one framebuffer negotiation before admission");
	retro_deinit();
	testStateRequiresInstalledMedia(testDirectory / "state-media");
	std::filesystem::remove_all(testDirectory);

	return 0;
}
