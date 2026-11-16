#include "bmsx_libretro.h"
#include "native_gate_profile.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/boot_rom_fixture.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <time.h>
#include <vector>

extern "C" int __real_clock_gettime(clockid_t, timespec*);
namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
u64 nanoseconds(const timespec& now) { return static_cast<u64>(now.tv_sec) * 1000000000u + static_cast<u64>(now.tv_nsec); }
u64 now() { timespec stamp; __real_clock_gettime(CLOCK_MONOTONIC, &stamp); return nanoseconds(stamp); }
std::vector<u64> clocks;
thread_local bool captureClocks = false;
struct Logged { std::string line; u64 at; };
std::vector<Logged> logs;
std::string directory;
bool hardware = false;
unsigned inputPolls = 0;
void RETRO_CALLCONV logMessage(retro_log_level, const char* format, ...) {
	const u64 at = now();
	std::array<char, 4096> buffer;
	va_list args; va_start(args, format);
	const int count = std::vsnprintf(buffer.data(), buffer.size(), format, args);
	va_end(args);
	require(count >= 0 && static_cast<size_t>(count) < buffer.size(), "diagnostic output fits its test capture");
	logs.push_back({std::string(buffer.data(), count), at});
}
std::map<std::string, u64> fields(const std::string& line) {
	std::map<std::string, u64> result;
	std::istringstream input(line); std::string token;
	while (input >> token) {
		const auto equal = token.find('=');
		if (equal != std::string::npos && token.substr(0, equal) != "kind") result.emplace(token.substr(0, equal), std::stoull(token.substr(equal + 1)));
	}
	return result;
}
const Logged& summary(size_t index) {
	size_t found = 0;
	for (const auto& log : logs) if (log.line.starts_with("[BMSX][native-gate-profile] ")) {
		if (found++ == index) return log;
	}
	throw std::runtime_error("each actual retro_run/scope must emit one complete summary");
}
void interval(const Logged& log, u64 before, u64 after, u64 index, bool cpu) {
	const auto values = fields(log.line);
	require(values.at("retro_run_index") == index && values.at("cpu_present") == cpu, "the logger preserves zero-born invocation index and actual CPU presence");
	require(before <= values.at("begin_monotonic_ns") && values.at("begin_monotonic_ns") <= values.at("end_monotonic_ns")
		&& values.at("end_monotonic_ns") <= log.at && log.at <= after, "real monotonic bookends enclose work and exclude the logging callback");
	require(values.at("dispatch_entries") == values.at("native_resumes") + values.at("null_returns")
		&& values.at("dispatch_exceptions") <= values.at("null_returns"), "logged dispatch deltas preserve all outcome identities");
	require(values.at("builtin_attempts") == values.at("builtin_declines") + values.at("builtin_resumes") + values.at("builtin_stops"), "logged builtin attempts preserve outcome identity");
	require(values.at("unique_handling") == values.at("dispatch_entries") + values.at("builtin_resumes") + values.at("builtin_stops")
		&& values.at("raw_cpp_entries") == values.at("dispatch_entries") + values.at("builtin_attempts"), "declined builtin followed by dispatch is not double-counted as unique handling");
}
bool environment(unsigned command, void* data) {
	if (command == RETRO_ENVIRONMENT_GET_LOG_INTERFACE) { static_cast<retro_log_callback*>(data)->log = logMessage; return true; }
	if (command == RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY) { *static_cast<const char**>(data) = directory.c_str(); return true; }
	if (command == RETRO_ENVIRONMENT_GET_VARIABLE) {
		auto& variable = *static_cast<retro_variable*>(data);
		if (std::strcmp(variable.key, "bmsx_render_backend") == 0) { variable.value = hardware ? "gles2" : "software"; return true; }
	}
	if (command == RETRO_ENVIRONMENT_SET_PIXEL_FORMAT) return *static_cast<retro_pixel_format*>(data) == RETRO_PIXEL_FORMAT_XRGB8888;
	if (command == RETRO_ENVIRONMENT_SET_HW_RENDER) return true; // Actual frontend never supplies the requested context reset.
	return false;
}
void video(const void*, unsigned, unsigned, size_t) {}
void poll() { ++inputPolls; }
int16_t input(unsigned, unsigned, unsigned, unsigned) { return 0; }

void realInvocations() {
	const auto path = std::filesystem::temp_directory_path() / "bmsx_native_gate_profile_test";
	std::filesystem::create_directories(path); directory = path.string();
	const auto bios = test::makeMinimalBootRom(RomImageDomain::System);
	std::ofstream file(path / "bmsx-bios.rom", std::ios::binary);
	file.write(reinterpret_cast<const char*>(bios.data()), static_cast<std::streamsize>(bios.size())); file.close();
	retro_set_environment(environment); retro_set_video_refresh(video); retro_set_input_poll(poll); retro_set_input_state(input);
	retro_init(); require(retro_load_game(nullptr), "normal software lifecycle loads real system firmware");
	logs.clear();
	for (u64 index = 0; index < 2; ++index) {
		const auto before = now(); retro_run(); const auto after = now();
		interval(summary(index), before, after, index, true);
	}
	require(inputPolls == 2, "the integration cases really execute two ordinary frontend frames");
	retro_unload_game(); retro_deinit();
#if BMSX_ENABLE_GLES2
	hardware = true;
	retro_init(); // The normal core enters Fatal because this frontend did not initialize its requested context.
	logs.clear(); const auto pollsBefore = inputPolls;
	for (u64 index = 0; index < 2; ++index) {
		clocks.clear(); const auto before = now(); captureClocks = true; retro_run(); captureClocks = false; const auto after = now();
		interval(summary(index), before, after, index, false);
		require(clocks.size() == 2, "a real lifecycle early return still executes exactly the two profile bookends");
		require(fields(summary(index).line).at("begin_monotonic_ns") == clocks[0]
			&& fields(summary(index).line).at("end_monotonic_ns") == clocks[1], "early-return timestamps are the real clock calls, not estimates");
	}
	require(inputPolls == pollsBefore, "the early-return test does not accidentally run guest/input work");
	retro_deinit(); hardware = false;
#endif
	std::filesystem::remove_all(path);
}

void cumulativeCountersAndRealGc() {
	test::Blua32TestImage source; source.text.resize(MAPPED_PAGE_BYTE_SIZE); // Cold native preparation consumes a real backed instruction page.
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	source.functions = {{.firstWord=0, .wordCount=1, .maxStack=4}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, source);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
	cpu.reset(); cpu.prepareSystemNativeCode();
	resetLibretroNativeGateProfile(); logs.clear();
	const auto gcBefore = cpu.diagnosticGcProfile().collections;
	const auto start = now();
	{ NativeGateProfileFrame frame(&cpu, logMessage); cpu.runUntilDepth(0, 2); cpu.collectHeap(); }
	const auto end = now(); interval(summary(0), start, end, 0, true);
	const auto first = fields(summary(0).line);
	require(first.at("dispatch_entries") == 1 && first.at("null_returns") == 1
		&& first.at("gc_collections") == 1 && cpu.diagnosticGcProfile().collections == gcBefore + 1,
		"the logger reports actual HALT and the existing real collection producer, not synthetic seeded counters");
	const u64 phaseSum = first.at("gc_roots_ns") + first.at("gc_trace_ns") + first.at("gc_weak_ns")
		+ first.at("gc_sweep_ns") + first.at("gc_string_reclaim_ns") + first.at("gc_mark_again_ns");
	require(phaseSum <= first.at("gc_total_ns") && first.at("gc_total_ns") <= first.at("end_monotonic_ns") - first.at("begin_monotonic_ns"),
		"real collection phase totals stay inside their enclosing collection and frame clocks");
	require(first.at("gc_steps") >= 3 && first.at("gc_full_collections") == 1
		&& first.at("gc_atomic_ns") <= first.at("gc_total_ns") && first.at("gc_max_step_lifetime_ns") > 0,
		"the log distinguishes incremental calls, synchronous collections and enclosing atomic work");
	const auto start2 = now();
	{ NativeGateProfileFrame frame(&cpu, logMessage); }
	const auto end2 = now(); interval(summary(1), start2, end2, 1, true);
	const auto second = fields(summary(1).line);
	require(second.at("dispatch_entries") == 0 && second.at("gc_collections") == 0
		&& second.at("gc_total_ns") == 0 && cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::Halt)].entries == 1,
		"empty scopes emit zero deltas without clearing the real CPU lifetime counts");
	resetLibretroNativeGateProfile(); logs.clear(); clocks.clear();
	const auto start3 = now(); captureClocks = true;
	{ NativeGateProfileFrame frame(nullptr, logMessage); }
	captureClocks = false; const auto end3 = now();
	interval(summary(0), start3, end3, 0, false);
	require(clocks.size() == 2 && cpu.diagnosticGcProfile().collections == gcBefore + 1,
		"reset changes only invocation indexing and leaves live CPU/GC counters intact");
}
} // namespace
extern "C" int __wrap_clock_gettime(clockid_t id, timespec* stamp) {
	const int result = __real_clock_gettime(id, stamp);
	if (captureClocks && id == CLOCK_MONOTONIC) clocks.push_back(nanoseconds(*stamp));
	return result;
}
int main() {
	try { realInvocations(); cumulativeCountersAndRealGc(); }
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
