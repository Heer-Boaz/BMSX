/*
 * entry.cpp - Libretro core entry points
 *
 * This file implements all the required libretro callbacks that RetroArch
 * uses to communicate with the BMSX machine runtime.
 */

#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cstdint>
#include <exception>
#include <stdexcept>
#include <string>
#include <array>
#include <memory>
#include <optional>
#include <span>

#include "audio_output.h"
#include "common/compiler.h"
#include "bmsx_libretro.h"
#include "content.h"
#include "host_frame.h"
#if defined(BMSX_NATIVE_GATE_PROFILE)
#include "native_gate_profile.h"
#endif
#if BMSX_ENABLE_GLES2
#include "gles_frame_worker.h"
#endif
#include "host_overlay_menu.h"
#include "input.h"
#include "libretro_state.h"
#include "presentation_state.h"
#include "rewind.h"
#include "runtime_error.h"
#include "video_output.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/gx/gp1.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/runtime/runtime.h"
#include "render/backend/pass/library.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#endif

// Core info
static constexpr const char* CORE_NAME = "BMSX";
static constexpr const char* CORE_VERSION = "1.0.0";
static constexpr const char* VALID_EXTENSIONS = "rom|bmsx";
static retro_subsystem_rom_info CARTRIDGE_SUBSYSTEM_ROMS[] = {
	{ "Cartridge slot 0", VALID_EXTENSIONS, true, false, true, nullptr, 0 },
	{ "Cartridge slot 1", VALID_EXTENSIONS, true, false, false, nullptr, 0 },
};
static retro_subsystem_info CARTRIDGE_SUBSYSTEMS[] = {
	{
		"BMSX Dual Cartridge",
		"dualcart",
		CARTRIDGE_SUBSYSTEM_ROMS,
		bmsx::CARTRIDGE_SLOT_COUNT,
		BMSX_SUBSYSTEM_DUAL_CARTRIDGE,
	},
	{},
};

// Libretro callbacks
static retro_environment_t environ_cb = nullptr;
static retro_video_refresh_t video_cb = nullptr;
static retro_audio_sample_t audio_cb = nullptr;
static retro_audio_sample_batch_t audio_batch_cb = nullptr;
static retro_input_poll_t input_poll_cb = nullptr;
static retro_input_state_t input_state_cb = nullptr;
static retro_log_callback logging;

static bool RETRO_CALLCONV supervisor_request_line_low(void) {
	return false;
}

static bmsx_supervisor_request_line_t g_supervisor_request_line_cb =
	supervisor_request_line_low;

static void RETRO_CALLCONV set_audio_transport_suspended_noop(bool) {
}

static bmsx_set_audio_transport_suspended_t g_set_audio_transport_suspended_cb =
	set_audio_transport_suspended_noop;

enum class HardwareContextLifecycle : uint8_t {
	Software,
	AwaitingReset,
	ResetPending,
	Ready,
	Fatal,
};

static retro_hw_render_callback g_hw_render;
static HardwareContextLifecycle g_hw_context_lifecycle = HardwareContextLifecycle::Software;
static bmsx::BackendType g_active_backend = bmsx::BackendType::Software;
static std::string g_backend_error;
static std::string g_system_dir;

static std::unique_ptr<bmsx::LibretroInput> g_input;
static std::unique_ptr<bmsx::LibretroAudioOutput> g_audio_output;
static bmsx::LibretroVideoOutput g_video_output;
static std::unique_ptr<bmsx::VideoPresenter> g_video_presenter;
static std::unique_ptr<bmsx::Font> g_default_font;
static const bmsx::SoftwarePresentationTarget* g_software_target = nullptr;
static std::unique_ptr<bmsx::LibretroContent> g_content;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
static bool g_profile_native_compilation = false;

static void RETRO_CALLCONV read_native_compilation_profile(BmsxNativeCompilationProfileV2* output) {
	const auto profile = g_content->runtime.machine.cpu.readNativeCompilationProfile();
	*output = {
		{
			profile.prepareRequests, profile.regionsPublished, profile.entriesPublished,
			profile.sourceInstructions, profile.emittedCodeBytes, profile.codeBytes, profile.peakCodeBytes,
			profile.prepareNanoseconds, profile.maxPrepareNanoseconds, profile.discoveryNanoseconds,
			profile.retirementNanoseconds, profile.compilationNanoseconds, profile.mergedRegions,
			profile.mergedCodeBytes, profile.capacityEvictedRegions, profile.capacityRetiredCodeBytes,
			profile.maxPrepareDomain, profile.maxPrepareCartridgeSlot, profile.maxPrepareRootPc, profile.maxPreparePagePc,
		},
		profile.backgroundCompleted, profile.backgroundCancelled, profile.backgroundNanoseconds,
	};
}
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
static void RETRO_CALLCONV read_execution_profile(BmsxExecutionProfile* output) {
	const auto& machine = g_content->runtime.machine;
	const auto& gc = machine.cpu.diagnosticGcProfile();
	*output = {
		machine.scheduler.nowCycles(), machine.scheduler.diagnosticCpuSliceCount,
		machine.scheduler.diagnosticCpuSliceConsumedCycles,
		gc.collections, gc.totalNanoseconds, gc.rootsNanoseconds, gc.traceNanoseconds,
		gc.weakNanoseconds, gc.sweepNanoseconds, gc.stringReclaimNanoseconds,
		gc.fullCollections, gc.steps, gc.maxStepNanoseconds, gc.stepsOver2ms, gc.stepsOver8ms, gc.markAgainNanoseconds, gc.atomicNanoseconds,
		machine.scheduler.diagnosticNativeOriginCycles, machine.scheduler.diagnosticInterpreterRuntimeCycles,
		machine.scheduler.diagnosticNativeOpcodes.call,
		machine.scheduler.diagnosticNativeOpcodes.setfield, machine.scheduler.diagnosticNativeOpcodes.concat,
		machine.scheduler.diagnosticNativeOpcodes.concatn,
		machine.scheduler.diagnosticInterpreterOpcodes.call,
		machine.scheduler.diagnosticInterpreterOpcodes.setfield, machine.scheduler.diagnosticInterpreterOpcodes.concat,
		machine.scheduler.diagnosticInterpreterOpcodes.concatn,
	};
}
#endif
static std::optional<bmsx::OnScreenKeyboard> g_keyboard_model;
static std::optional<bmsx::HostOnScreenKeyboard> g_keyboard_view;
static std::optional<bmsx::HostKeyboardInteraction> g_keyboard_interaction;
static std::optional<bmsx::HostOverlayMenu> g_overlay_menu;
static std::optional<bmsx::RenderPresentationState> g_presentation;
static std::optional<bmsx::HostRewind> g_rewind;
static bool g_runtime_reset_completed = false;
#if BMSX_ENABLE_GLES2
static std::unique_ptr<bmsx::GlesFrameWorker> g_gles_frame_worker;
#endif
static double g_frame_time_sec =
	static_cast<double>(bmsx::HZ_SCALE)
	/ static_cast<double>(bmsx::GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
static double g_total_time = 0.0;
static int64_t g_runtime_ufps_scaled = 0;
static bool g_single_guest_tick = false;
static bool g_run_cadence_accepted = false;
static BmsxRunCadenceV1 g_run_cadence{};

static int32_t RETRO_CALLCONV read_active_execution_domain_id(void) {
	return g_content->runtime.machine.cpu.activeCartridgeSlot();
}

static void RETRO_CALLCONV read_guest_progress(BmsxGuestProgressV1* progress) {
	const auto& runtime = g_content->runtime;
	*progress = {runtime.frameScheduler.lastTickSequence, runtime.machine.scheduler.currentNowCycles()};
}

static void RETRO_CALLCONV cancel_keyboard_input(void) {
	g_input->cancelKeyboardControlShortcutGesture();
}

static void RETRO_CALLCONV cancel_gamepad_input(unsigned port) {
	g_input->cancelGamepadControlShortcutGesture(port);
}

static int64_t g_current_ufps_scaled = bmsx::GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED;

#if BMSX_ENABLE_GLES2
static bool RETRO_CALLCONV read_gx_upload_profile_frame(
		uint64_t afterRenderFrameSerial,
	BmsxGxUploadProfileFrameV2* frame) {
	auto* backend = &static_cast<bmsx::OpenGLES2Backend&>(
		g_video_presenter->backend());
	bmsx::GxUploadProfileFrame profile;
	if (!backend->readGxUploadProfileFrame(afterRenderFrameSerial, profile)) {
		return false;
	}
	*frame = BmsxGxUploadProfileFrameV2{
		profile.renderFrameSerial,
		profile.commands,
		profile.logicalBytes,
		profile.hostCalls,
		profile.hostBytes,
		profile.elapsedNanoseconds,
		profile.maxCommandNanoseconds,
		profile.softwareScanoutPixels,
		profile.softwareScanoutNanoseconds,
		profile.scanoutUploadCalls,
		profile.scanoutUploadBytes,
		profile.scanoutUploadNanoseconds,
	};
	return true;
}
#endif

static void sync_current_av_info(int64_t ufps_scaled) {
	g_video_output.setFrameRate(ufps_scaled);
	g_current_ufps_scaled = ufps_scaled;
	const auto& timing = g_video_output.avInfo().timing;
	g_frame_time_sec = 1.0 / timing.fps;
	g_audio_output->setSampleRate(timing.sample_rate);
}

static void RETRO_CALLCONV keyboard_event(bool down, unsigned keycode, uint32_t character, uint16_t key_modifiers) {
	(void)character;
	(void)key_modifiers;
	g_input->postKeyboardEvent(keycode, down);
}

static constexpr const char* kOptionRewindRecording = "bmsx_rewind_recording";
static constexpr const char* kOptionGamepadHoldAction = "bmsx_gamepad_hold_action";
static constexpr const char* kGamepadHoldRewind = "rewind";
static constexpr const char* kGamepadHoldExit = "exit";
static constexpr const char* kOptionRenderBackend = "bmsx_render_backend";
static constexpr const char* kRenderBackendSoftware = "software";
static constexpr const char* kRenderBackendGLES2 = "gles2";
static constexpr const char* kOptionCrtPostprocessing = "bmsx_crt_postprocessing";
static constexpr const char* kCrtPostprocessingOff = "off";
static constexpr const char* kCrtPostprocessingOn = "on";
static constexpr const char* kOptionCrtNoise = "bmsx_crt_noise";
static constexpr const char* kOptionCrtColorBleed = "bmsx_crt_color_bleed";
static constexpr const char* kOptionCrtScanlines = "bmsx_crt_scanlines";
static constexpr const char* kOptionCrtBlur = "bmsx_crt_blur";
static constexpr const char* kOptionCrtGlow = "bmsx_crt_glow";
static constexpr const char* kOptionCrtFringing = "bmsx_crt_fringing";
static constexpr const char* kOptionCrtAperture = "bmsx_crt_aperture";
static constexpr const char* kOptionDither = "bmsx_dither";
static constexpr const char* kOptionHostShowUsageGizmo = "bmsx_host_show_usage_gizmo";
static constexpr const char* kToggleOff = "off";
static constexpr const char* kToggleOn = "on";
#if defined(BMSX_PLATFORM_SNESMINI)
static constexpr bool kDefaultRewindRecording = false;
#else
static constexpr bool kDefaultRewindRecording = true;
#endif
static constexpr const char* kDefaultRewindRecordingName = kDefaultRewindRecording ? kToggleOn : kToggleOff;
static constexpr const char* kDitherOff = "off";
static constexpr const char* kDitherRGB565 = "rgb565";
static constexpr const char* kDitherMSX10 = "msx10";

enum class RenderBackendPreference {
	Auto,
	Software,
	GLES2
};

static RenderBackendPreference g_backend_preference = RenderBackendPreference::Auto;
static bool g_crt_postprocessing_enabled = true;
static bool g_crt_noise_enabled = true;
static bool g_crt_color_bleed_enabled = true;
static bool g_crt_scanlines_enabled = true;
static bool g_crt_blur_enabled = true;
static bool g_crt_glow_enabled = true;
static bool g_crt_fringing_enabled = true;
static bool g_crt_aperture_enabled = false;
static bmsx::DeviceQuantizeMode g_device_quantize_mode = bmsx::DeviceQuantizeMode::None;
static bool g_resource_usage_gizmo_enabled = false;

static retro_core_option_v2_category g_option_categories_us[] = {
	{"video", "Video", "Video settings."},
	{"host", "Host", "Host features."},
	{nullptr, nullptr, nullptr},
};

static retro_core_option_v2_definition g_option_defs_us[] = {
	{
		kOptionRenderBackend,
		"Render Backend",
		"Render Backend",
		"Select the renderer backend. Requires restart.",
		"Select the renderer backend. Requires restart.",
		"video",
		{
			{kRenderBackendSoftware, "Software"},
			{kRenderBackendGLES2, "GLES2"},
			{nullptr, nullptr},
		},
		kRenderBackendSoftware
	},
	{
		kOptionCrtPostprocessing,
		"CRT Post-processing",
		"CRT Post-processing",
		"Enable CRT post-processing.",
		"Enable CRT post-processing.",
		"video",
		{
			{kCrtPostprocessingOn, "On"},
			{kCrtPostprocessingOff, "Off"},
			{nullptr, nullptr},
		},
		kCrtPostprocessingOn
	},
	{
		kOptionCrtNoise,
		"CRT Noise",
		"CRT Noise",
		"Toggle CRT noise/grain.",
		"Toggle CRT noise/grain.",
		"video",
		{
			{kToggleOn, "On"},
			{kToggleOff, "Off"},
			{nullptr, nullptr},
		},
		kToggleOn
	},
	{
		kOptionCrtColorBleed,
		"CRT Color Bleed",
		"CRT Color Bleed",
		"Toggle CRT color bleed.",
		"Toggle CRT color bleed.",
		"video",
		{
			{kToggleOn, "On"},
			{kToggleOff, "Off"},
			{nullptr, nullptr},
		},
		kToggleOn
	},
	{
		kOptionCrtScanlines,
		"CRT Scanlines",
		"CRT Scanlines",
		"Toggle CRT scanlines.",
		"Toggle CRT scanlines.",
		"video",
		{
			{kToggleOn, "On"},
			{kToggleOff, "Off"},
			{nullptr, nullptr},
		},
		kToggleOn
	},
	{
		kOptionCrtBlur,
		"CRT Blur",
		"CRT Blur",
		"Toggle CRT blur.",
		"Toggle CRT blur.",
		"video",
		{
			{kToggleOn, "On"},
			{kToggleOff, "Off"},
			{nullptr, nullptr},
		},
		kToggleOn
	},
	{
		kOptionCrtGlow,
		"CRT Glow",
		"CRT Glow",
		"Toggle CRT glow.",
		"Toggle CRT glow.",
		"video",
		{
			{kToggleOn, "On"},
			{kToggleOff, "Off"},
			{nullptr, nullptr},
		},
		kToggleOn
	},
	{
		kOptionCrtFringing,
		"CRT Fringing",
		"CRT Fringing",
		"Toggle CRT fringing.",
		"Toggle CRT fringing.",
		"video",
		{
			{kToggleOn, "On"},
			{kToggleOff, "Off"},
			{nullptr, nullptr},
		},
		kToggleOn
	},
	{
		kOptionCrtAperture,
		"CRT Aperture",
		"CRT Aperture",
		"Toggle CRT aperture grille.",
		"Toggle CRT aperture grille.",
		"video",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionDither,
		"Output Dither",
		"Output Dither",
		"Select host output color quantization.",
		"Select host output color quantization.",
		"video",
		{
			{kDitherOff, "Off"},
			{kDitherRGB565, "RGB565"},
			{kDitherMSX10, "MSX10 3:4:3"},
			{nullptr, nullptr},
		},
		kDitherOff
	},
	{
		kOptionHostShowUsageGizmo,
		"Show Usage Gizmo",
		"Show Usage Gizmo",
		"Toggle the CPU/RAM/VRAM usage overlay.",
		"Toggle the CPU/RAM/VRAM usage overlay.",
		"video",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionRewindRecording,
		"Rewind Recording",
		"Rewind Recording",
		"Record periodic checkpoints for rewind. Disabling recording does not disable save states.",
		"Record periodic checkpoints for rewind. Disabling recording does not disable save states.",
		"host",
		{{kToggleOff, "Off"}, {kToggleOn, "On"}, {nullptr, nullptr}},
		kDefaultRewindRecordingName
	},
	{
		kOptionGamepadHoldAction,
		"Select + Start Hold",
		"Select + Start Hold",
		"Choose the action for holding Select and Start on a controller.",
		"Choose the action for holding Select and Start on a controller.",
		"host",
		{{kGamepadHoldRewind, "Rewind"}, {kGamepadHoldExit, "Exit Game"}, {nullptr, nullptr}},
		kGamepadHoldRewind
	},
	{nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, {{nullptr, nullptr}}, nullptr}
};

static retro_core_options_v2 g_options_us = {
	g_option_categories_us,
	g_option_defs_us
};

static retro_core_option_definition g_option_defs_v1_us[] = {
	{
		kOptionRenderBackend,
		"Render Backend",
		"Select the renderer backend. Requires restart.",
		{
			{kRenderBackendSoftware, "Software"},
			{kRenderBackendGLES2, "GLES2"},
			{nullptr, nullptr},
		},
		kRenderBackendSoftware
	},
	{
		kOptionCrtPostprocessing,
		"CRT Post-processing",
		"Enable CRT post-processing.",
		{
			{kCrtPostprocessingOff, "Off"},
			{kCrtPostprocessingOn, "On"},
			{nullptr, nullptr},
		},
		kCrtPostprocessingOff
	},
	{
		kOptionCrtNoise,
		"CRT Noise",
		"Toggle CRT noise/grain.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionCrtColorBleed,
		"CRT Color Bleed",
		"Toggle CRT color bleed.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionCrtScanlines,
		"CRT Scanlines",
		"Toggle CRT scanlines.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionCrtBlur,
		"CRT Blur",
		"Toggle CRT blur.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionCrtGlow,
		"CRT Glow",
		"Toggle CRT glow.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionCrtFringing,
		"CRT Fringing",
		"Toggle CRT fringing.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionCrtAperture,
		"CRT Aperture",
		"Toggle CRT aperture grille.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionDither,
		"Output Dither",
		"Select host output color quantization.",
		{
			{kDitherOff, "Off"},
			{kDitherRGB565, "RGB565"},
			{kDitherMSX10, "MSX10 3:4:3"},
			{nullptr, nullptr},
		},
		kDitherOff
	},
	{
		kOptionHostShowUsageGizmo,
		"Show Usage Gizmo",
		"Toggle the CPU/RAM/VRAM usage overlay.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{
		kOptionRewindRecording,
		"Rewind Recording",
		"Record periodic checkpoints for rewind. Disabling recording does not disable save states.",
		{{kToggleOff, "Off"}, {kToggleOn, "On"}, {nullptr, nullptr}},
		kDefaultRewindRecordingName
	},
	{
		kOptionGamepadHoldAction,
		"Select + Start Hold",
		"Choose the action for holding Select and Start on a controller.",
		{{kGamepadHoldRewind, "Rewind"}, {kGamepadHoldExit, "Exit Game"}, {nullptr, nullptr}},
		kGamepadHoldRewind
	},
	{nullptr, nullptr, nullptr, {{nullptr, nullptr}}, nullptr}
};

static char g_option_rewind_recording_var[128] = {};
static char g_option_render_backend_var[128] = {};
static char g_option_crt_postprocessing_var[128] = {};
static char g_option_crt_noise_var[128] = {};
static char g_option_crt_color_bleed_var[128] = {};
static char g_option_crt_scanlines_var[128] = {};
static char g_option_crt_blur_var[128] = {};
static char g_option_crt_glow_var[128] = {};
static char g_option_crt_fringing_var[128] = {};
static char g_option_crt_aperture_var[128] = {};
static char g_option_dither_var[128] = {};
static char g_option_host_show_usage_gizmo_var[128] = {};
static retro_variable g_option_vars[] = {
	{kOptionRenderBackend, nullptr},
	{kOptionCrtPostprocessing, nullptr},
	{kOptionCrtNoise, nullptr},
	{kOptionCrtColorBleed, nullptr},
	{kOptionCrtScanlines, nullptr},
	{kOptionCrtBlur, nullptr},
	{kOptionCrtGlow, nullptr},
	{kOptionCrtFringing, nullptr},
	{kOptionCrtAperture, nullptr},
	{kOptionDither, nullptr},
	{kOptionHostShowUsageGizmo, nullptr},
	{kOptionRewindRecording, nullptr},
	{kOptionGamepadHoldAction, "Select + Start Hold; rewind|exit"},
	{nullptr, nullptr}
};

// Forward declarations
static void fallback_log(enum retro_log_level level, const char* fmt, ...);
static void hw_context_reset();
static void hw_context_destroy();
static void set_core_options(bool default_gles2);
static RenderBackendPreference read_backend_preference();
#if BMSX_ENABLE_GLES2
static RenderBackendPreference parse_backend_preference(const char* value);
#endif
static bmsx::BackendType resolve_backend_preference(RenderBackendPreference preference);
static bool is_hardware_backend(bmsx::BackendType type);
static const char* backend_label(bmsx::BackendType type);
static void fail_hardware_backend(bmsx::BackendType backend, const char* reason);
static bool read_crt_postprocessing_enabled();
static bool read_crt_noise_enabled();
static bool read_crt_color_bleed_enabled();
static bool read_crt_scanlines_enabled();
static bool read_crt_blur_enabled();
static bool read_crt_glow_enabled();
static bool read_crt_fringing_enabled();
static bool read_crt_aperture_enabled();
static bmsx::DeviceQuantizeMode read_device_quantize_mode();
static bool read_toggle_option(const char* key, const char* label, bool default_value);
static bool read_resource_usage_gizmo_enabled();
static bmsx::HostMenuShortcutAction read_gamepad_hold_action();

/* ============================================================================
 * Libretro callback setters
 * ============================================================================
 */

static bmsx::BackendType resolve_backend_preference(RenderBackendPreference preference) {
#if !BMSX_ENABLE_GLES2
	(void)preference;
	return bmsx::BackendType::Software;
#else
	if (preference == RenderBackendPreference::Software) {
		return bmsx::BackendType::Software;
	}
	if (preference == RenderBackendPreference::GLES2) {
		return bmsx::BackendType::OpenGLES2;
	}
	return bmsx::BackendType::OpenGLES2;
#endif
}

static bool is_hardware_backend(bmsx::BackendType type) {
	switch (type) {
		case bmsx::BackendType::Software:
			return false;
		case bmsx::BackendType::OpenGLES2:
			return true;
		default:
			throw BMSX_RUNTIME_ERROR("[BMSX] Unsupported libretro backend.");
	}
}

static const char* backend_label(bmsx::BackendType type) {
	switch (type) {
		case bmsx::BackendType::Software:
			return "Software";
		case bmsx::BackendType::OpenGLES2:
			return "GLES2";
		default:
			throw BMSX_RUNTIME_ERROR("[BMSX] Unsupported libretro backend.");
	}
}

static bool isHardwareBackendActive() {
	switch (g_hw_context_lifecycle) {
		case HardwareContextLifecycle::AwaitingReset:
		case HardwareContextLifecycle::ResetPending:
		case HardwareContextLifecycle::Ready:
			return is_hardware_backend(g_active_backend);
		case HardwareContextLifecycle::Software:
		case HardwareContextLifecycle::Fatal:
			return false;
	}
	BMSX_UNREACHABLE();
}

static bool offerGxUploadProfileInterface(retro_environment_t environment) {
#if BMSX_ENABLE_GLES2
	if (isHardwareBackendActive()) {
		BmsxGxUploadProfileInterfaceV2 gxUploadProfileInterface{
			read_gx_upload_profile_frame,
		};
		return environment(
			BMSX_ENVIRONMENT_SET_GX_UPLOAD_PROFILE_INTERFACE_V2,
			&gxUploadProfileInterface);
	}
#else
	(void)environment;
#endif
	return false;
}

static void set_crt_option_values(bool enabled) {
	const char* const value_off = kToggleOff;
	const char* const value_on = kToggleOn;
	const char* const label_off = "Off";
	const char* const label_on = "On";

	const auto set_toggle = [&](int idx, bool allow_on) {
		if (allow_on) {
			g_option_defs_us[idx].values[0] = {value_off, label_off};
			g_option_defs_us[idx].values[1] = {value_on, label_on};
			g_option_defs_us[idx].values[2] = {nullptr, nullptr};
			g_option_defs_v1_us[idx].values[0] = {value_off, label_off};
			g_option_defs_v1_us[idx].values[1] = {value_on, label_on};
			g_option_defs_v1_us[idx].values[2] = {nullptr, nullptr};
			return;
		}

		g_option_defs_us[idx].values[0] = {value_off, label_off};
		g_option_defs_us[idx].values[1] = {nullptr, nullptr};
		g_option_defs_us[idx].values[2] = {nullptr, nullptr};
		g_option_defs_v1_us[idx].values[0] = {value_off, label_off};
		g_option_defs_v1_us[idx].values[1] = {nullptr, nullptr};
		g_option_defs_v1_us[idx].values[2] = {nullptr, nullptr};
	};

	const auto set_default = [&](int idx, const char* value) {
		g_option_defs_us[idx].default_value = value;
		g_option_defs_v1_us[idx].default_value = value;
	};

	const bool allow_crt = enabled;
	set_toggle(1, allow_crt);
	set_toggle(2, allow_crt);
	set_toggle(3, allow_crt);
	set_toggle(4, allow_crt);
	set_toggle(5, allow_crt);
	set_toggle(6, allow_crt);
	set_toggle(7, allow_crt);
	set_toggle(8, allow_crt);

	set_default(1, kCrtPostprocessingOff);
	set_default(2, kToggleOff);
	set_default(3, kToggleOff);
	set_default(4, kToggleOff);
	set_default(5, kToggleOff);
	set_default(6, kToggleOff);
	set_default(7, kToggleOff);
	set_default(8, kToggleOff);
}

static void set_core_options(bool default_gles2) {
#if BMSX_ENABLE_GLES2
	const char* default_backend = default_gles2 ? kRenderBackendGLES2 : kRenderBackendSoftware;
#else
	(void)default_gles2;
	const char* default_backend = kRenderBackendSoftware;
#endif
	g_option_defs_us[0].default_value = default_backend;
	g_option_defs_v1_us[0].default_value = default_backend;

#if BMSX_ENABLE_GLES2
	g_option_defs_us[0].values[0] = {kRenderBackendGLES2, "GLES2"};
	g_option_defs_us[0].values[1] = {kRenderBackendSoftware, "Software"};
	g_option_defs_us[0].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[0].values[0] = {kRenderBackendGLES2, "GLES2"};
	g_option_defs_v1_us[0].values[1] = {kRenderBackendSoftware, "Software"};
	g_option_defs_v1_us[0].values[2] = {nullptr, nullptr};
#else
	g_option_defs_us[0].values[0] = {kRenderBackendSoftware, "Software"};
	g_option_defs_us[0].values[1] = {nullptr, nullptr};
	g_option_defs_us[0].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[0].values[0] = {kRenderBackendSoftware, "Software"};
	g_option_defs_v1_us[0].values[1] = {nullptr, nullptr};
	g_option_defs_v1_us[0].values[2] = {nullptr, nullptr};
#endif
	g_option_defs_us[1].values[0] = {kCrtPostprocessingOff, "Off"};
	g_option_defs_us[1].values[1] = {kCrtPostprocessingOn, "On"};
	g_option_defs_us[1].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[1].values[0] = {kCrtPostprocessingOff, "Off"};
	g_option_defs_v1_us[1].values[1] = {kCrtPostprocessingOn, "On"};
	g_option_defs_v1_us[1].values[2] = {nullptr, nullptr};
	const bool crt_readonly = false;
	set_crt_option_values(true);

	g_option_defs_us[9].default_value = kDitherOff;
	g_option_defs_v1_us[9].default_value = kDitherOff;
	g_option_defs_us[9].values[0] = {kDitherOff, "Off"};
	g_option_defs_us[9].values[1] = {kDitherRGB565, "RGB565"};
	g_option_defs_us[9].values[2] = {kDitherMSX10, "MSX10 3:4:3"};
	g_option_defs_us[9].values[3] = {nullptr, nullptr};
	g_option_defs_v1_us[9].values[0] = {kDitherOff, "Off"};
	g_option_defs_v1_us[9].values[1] = {kDitherRGB565, "RGB565"};
	g_option_defs_v1_us[9].values[2] = {kDitherMSX10, "MSX10 3:4:3"};
	g_option_defs_v1_us[9].values[3] = {nullptr, nullptr};

	g_option_defs_us[10].default_value = kToggleOff;
	g_option_defs_v1_us[10].default_value = kToggleOff;
	g_option_defs_us[10].values[0] = {kToggleOff, "Off"};
	g_option_defs_us[10].values[1] = {kToggleOn, "On"};
	g_option_defs_us[10].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[10].values[0] = {kToggleOff, "Off"};
	g_option_defs_v1_us[10].values[1] = {kToggleOn, "On"};
	g_option_defs_v1_us[10].values[2] = {nullptr, nullptr};

#if BMSX_ENABLE_GLES2
	if (default_gles2) {
		std::snprintf(g_option_render_backend_var, sizeof(g_option_render_backend_var),
						"Render Backend; %s|%s", kRenderBackendGLES2, kRenderBackendSoftware);
	} else {
		std::snprintf(g_option_render_backend_var, sizeof(g_option_render_backend_var),
						"Render Backend; %s|%s", kRenderBackendSoftware, kRenderBackendGLES2);
	}
#else
	std::snprintf(g_option_render_backend_var, sizeof(g_option_render_backend_var),
					"Render Backend; %s", kRenderBackendSoftware);
#endif
	g_option_vars[0].value = g_option_render_backend_var;
	std::snprintf(g_option_crt_postprocessing_var, sizeof(g_option_crt_postprocessing_var),
					crt_readonly ? "CRT Post-processing; %s" : "CRT Post-processing; %s|%s",
					kCrtPostprocessingOn, kCrtPostprocessingOff);
	g_option_vars[1].value = g_option_crt_postprocessing_var;
	std::snprintf(g_option_crt_noise_var, sizeof(g_option_crt_noise_var),
					crt_readonly ? "CRT Noise; %s" : "CRT Noise; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[2].value = g_option_crt_noise_var;
	std::snprintf(g_option_crt_color_bleed_var, sizeof(g_option_crt_color_bleed_var),
					crt_readonly ? "CRT Color Bleed; %s" : "CRT Color Bleed; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[3].value = g_option_crt_color_bleed_var;
	std::snprintf(g_option_crt_scanlines_var, sizeof(g_option_crt_scanlines_var),
					crt_readonly ? "CRT Scanlines; %s" : "CRT Scanlines; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[4].value = g_option_crt_scanlines_var;
	std::snprintf(g_option_crt_blur_var, sizeof(g_option_crt_blur_var),
					crt_readonly ? "CRT Blur; %s" : "CRT Blur; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[5].value = g_option_crt_blur_var;
	std::snprintf(g_option_crt_glow_var, sizeof(g_option_crt_glow_var),
					crt_readonly ? "CRT Glow; %s" : "CRT Glow; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[6].value = g_option_crt_glow_var;
	std::snprintf(g_option_crt_fringing_var, sizeof(g_option_crt_fringing_var),
					crt_readonly ? "CRT Fringing; %s" : "CRT Fringing; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[7].value = g_option_crt_fringing_var;
	std::snprintf(g_option_crt_aperture_var, sizeof(g_option_crt_aperture_var),
					crt_readonly ? "CRT Aperture; %s" : "CRT Aperture; %s|%s",
					kToggleOff, kToggleOn);
	g_option_vars[8].value = g_option_crt_aperture_var;
	std::snprintf(g_option_dither_var, sizeof(g_option_dither_var),
					"Output Dither; %s|%s|%s", kDitherOff, kDitherRGB565, kDitherMSX10);
	g_option_vars[9].value = g_option_dither_var;
	std::snprintf(g_option_host_show_usage_gizmo_var, sizeof(g_option_host_show_usage_gizmo_var),
					"Show Usage Gizmo; %s|%s", kToggleOff, kToggleOn);
	g_option_vars[10].value = g_option_host_show_usage_gizmo_var;
	std::snprintf(g_option_rewind_recording_var, sizeof(g_option_rewind_recording_var),
		"Rewind Recording; %s|%s", kDefaultRewindRecordingName,
		kDefaultRewindRecording ? kToggleOff : kToggleOn);
	g_option_vars[11].value = g_option_rewind_recording_var;

	unsigned version = 0;
	if (environ_cb(RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION, &version) && version >= 2) {
		environ_cb(RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2, &g_options_us);
		return;
	}
	if (version >= 1) {
		retro_core_options_intl options_intl;
		options_intl.us = g_option_defs_v1_us;
		options_intl.local = nullptr;
		if (!environ_cb(RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL, &options_intl)) {
			environ_cb(RETRO_ENVIRONMENT_SET_CORE_OPTIONS, g_option_defs_v1_us);
		}
		return;
	}

	environ_cb(RETRO_ENVIRONMENT_SET_VARIABLES, g_option_vars);
}

#if BMSX_ENABLE_GLES2
static RenderBackendPreference parse_backend_preference(const char* value) {
	if (!value || !value[0]) return RenderBackendPreference::Auto;
	if (std::strcmp(value, kRenderBackendSoftware) == 0 || std::strcmp(value, "Software") == 0) {
		return RenderBackendPreference::Software;
	}
	if (std::strcmp(value, kRenderBackendGLES2) == 0 || std::strcmp(value, "GLES2") == 0) {
		return RenderBackendPreference::GLES2;
	}
	logging.log(RETRO_LOG_WARN,
				"[BMSX] Unknown render backend option '%s', using automatic backend selection\n",
				value);
	return RenderBackendPreference::Auto;
}
#endif

static bool parse_toggle_option(const char* value, const char* label, bool default_value) {
	if (!value || !value[0]) return default_value;
	if (std::strcmp(value, kToggleOn) == 0 || std::strcmp(value, "On") == 0) {
		return true;
	}
	if (std::strcmp(value, kToggleOff) == 0 || std::strcmp(value, "Off") == 0) {
		return false;
	}
	logging.log(RETRO_LOG_WARN,
				"[BMSX] Unknown %s option '%s', using %s\n",
				label, value, default_value ? "on" : "off");
	return default_value;
}

static RenderBackendPreference read_backend_preference() {
#if !BMSX_ENABLE_GLES2
	return RenderBackendPreference::Software;
#else
	retro_variable var;
	var.key = kOptionRenderBackend;
	var.value = nullptr;
	if (environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE, &var) && var.value) {
		return parse_backend_preference(var.value);
	}
	return RenderBackendPreference::Auto;
#endif
}

static bool read_crt_postprocessing_enabled() {
	return read_toggle_option(kOptionCrtPostprocessing, "CRT post-processing", true);
}

static bool read_resource_usage_gizmo_enabled() {
	return read_toggle_option(kOptionHostShowUsageGizmo, "Show Usage Gizmo", false);
}

static bmsx::HostMenuShortcutAction read_gamepad_hold_action() {
	retro_variable var{kOptionGamepadHoldAction, nullptr};
	return environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE, &var) && var.value
		&& std::strcmp(var.value, kGamepadHoldExit) == 0
		? bmsx::HostMenuShortcutAction::ExitGame
		: bmsx::HostMenuShortcutAction::Rewind;
}

static bool read_toggle_option(const char* key, const char* label, bool default_value) {
	retro_variable var;
	var.key = key;
	var.value = nullptr;
	if (environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE, &var) && var.value) {
		return parse_toggle_option(var.value, label, default_value);
	}
	return default_value;
}

static bool read_crt_noise_enabled() {
	return read_toggle_option(kOptionCrtNoise, "CRT Noise", true);
}

static bool read_crt_color_bleed_enabled() {
	return read_toggle_option(kOptionCrtColorBleed, "CRT Color Bleed", true);
}

static bool read_crt_scanlines_enabled() {
	return read_toggle_option(kOptionCrtScanlines, "CRT Scanlines", true);
}

static bool read_crt_blur_enabled() {
	return read_toggle_option(kOptionCrtBlur, "CRT Blur", true);
}

static bool read_crt_glow_enabled() {
	return read_toggle_option(kOptionCrtGlow, "CRT Glow", true);
}

static bool read_crt_fringing_enabled() {
	return read_toggle_option(kOptionCrtFringing, "CRT Fringing", true);
}

static bool read_crt_aperture_enabled() {
	return read_toggle_option(kOptionCrtAperture, "CRT Aperture", false);
}

static bmsx::DeviceQuantizeMode read_device_quantize_mode() {
	retro_variable var;
	var.key = kOptionDither;
	var.value = kDitherOff;
	if (environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE, &var) && var.value) {
		if (std::strcmp(var.value, kDitherRGB565) == 0) return bmsx::DeviceQuantizeMode::Rgb565;
		if (std::strcmp(var.value, kDitherMSX10) == 0) return bmsx::DeviceQuantizeMode::Msx10Rgb343;
	}
	return bmsx::DeviceQuantizeMode::None;
}

static void fail_hardware_backend(bmsx::BackendType backend, const char* reason) {
	g_active_backend = backend;
	g_backend_error = reason;
	g_hw_context_lifecycle = HardwareContextLifecycle::Fatal;
	logging.log(RETRO_LOG_ERROR, "%s\n", reason);
	retro_message msg;
	msg.msg = g_backend_error.c_str();
	msg.frames = 240;
	environ_cb(RETRO_ENVIRONMENT_SET_MESSAGE, &msg);
}

static void request_hw_context_for_backend(bmsx::BackendType backend) {
	g_backend_error.clear();
	g_hw_context_lifecycle = HardwareContextLifecycle::Software;
	if (!is_hardware_backend(backend)) {
		return;
	}

	g_hw_context_lifecycle = HardwareContextLifecycle::AwaitingReset;
	std::memset(&g_hw_render, 0, sizeof(g_hw_render));
	g_hw_render.context_type = RETRO_HW_CONTEXT_OPENGLES2;
	g_hw_render.context_reset = hw_context_reset;
	g_hw_render.context_destroy = hw_context_destroy;
	g_hw_render.depth = false;
	g_hw_render.stencil = false;
	g_hw_render.bottom_left_origin = true;
	g_hw_render.cache_context = false;
	g_hw_render.version_major = 2;
	g_hw_render.version_minor = 0;
	g_hw_render.debug_context = false;

	logging.log(RETRO_LOG_INFO, "[BMSX] Requesting HW context for backend %s\n", backend_label(backend));

	if (!environ_cb(RETRO_ENVIRONMENT_SET_HW_RENDER, &g_hw_render)) {
		const std::string reason =
			std::string("[BMSX] ") + backend_label(backend) +
			" backend failed: RETRO_ENVIRONMENT_SET_HW_RENDER rejected by frontend";
		fail_hardware_backend(backend, reason.c_str());
		return;
	}
}

void retro_set_environment(retro_environment_t cb) {
	// RetroArch may reinstall this callback inside one core session. AV publication
	// validity follows retro_init/retro_deinit, not the callback function address.
	environ_cb = cb;
	g_video_output.setEnvironment(cb);
	if (g_input) {
		BmsxInputLifecycleInterfaceV1 lifecycle{cancel_keyboard_input, cancel_gamepad_input};
		cb(BMSX_ENVIRONMENT_SET_INPUT_LIFECYCLE_INTERFACE_V1, &lifecycle);
	}
	offerGxUploadProfileInterface(cb);
	BmsxExecutionDomainInterfaceV1 executionDomainInterface{
		read_active_execution_domain_id,
	};
	cb(BMSX_ENVIRONMENT_SET_EXECUTION_DOMAIN_INTERFACE_V1,
		&executionDomainInterface);
	BmsxGuestProgressInterfaceV1 guestProgressInterface{read_guest_progress};
	cb(BMSX_ENVIRONMENT_SET_GUEST_PROGRESS_INTERFACE_V1, &guestProgressInterface);
	g_run_cadence = {};
	g_run_cadence_accepted = cb(BMSX_ENVIRONMENT_SET_RUN_CADENCE_V1, &g_run_cadence);
	BmsxSupervisorRequestInterfaceV1 supervisorRequestInterface{
		supervisor_request_line_low,
	};
	if (cb(BMSX_ENVIRONMENT_GET_SUPERVISOR_REQUEST_INTERFACE_V1,
			&supervisorRequestInterface)) {
		g_supervisor_request_line_cb =
			supervisorRequestInterface.request_line_high;
	} else {
		g_supervisor_request_line_cb = supervisor_request_line_low;
	}
	BmsxAudioTransportInterface audioTransportInterface{
		set_audio_transport_suspended_noop,
	};
	if (cb(BMSX_ENVIRONMENT_GET_AUDIO_TRANSPORT_INTERFACE,
			&audioTransportInterface)) {
		g_set_audio_transport_suspended_cb = audioTransportInterface.set_suspended;
	} else {
		g_set_audio_transport_suspended_cb = set_audio_transport_suspended_noop;
	}

	// Try to get logging interface
	if (!cb(RETRO_ENVIRONMENT_GET_LOG_INTERFACE, &logging)) {
	logging.log = fallback_log;
	}

	// System firmware can run with both physical cartridge sockets empty.
	bool no_game = true;
	cb(RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME, &no_game);
	cb(RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO, CARTRIDGE_SUBSYSTEMS);

	uint64_t serialization_quirks = RETRO_SERIALIZATION_QUIRK_MUST_INITIALIZE;
	cb(RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS, &serialization_quirks);

	// Set input descriptors
	static const struct retro_input_descriptor input_desc[] = {
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_UP, "Up"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_DOWN, "Down"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_LEFT, "Left"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_RIGHT, "Right"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, "B"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, "A"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_X, "Y"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_Y, "X"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_L, "L"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_R, "R"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_START, "Start"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_SELECT, "Select"},
		// Player 2
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_UP, "Up (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_DOWN, "Down (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_LEFT, "Left (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_RIGHT, "Right (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, "B (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, "A (P2)"},
		{0, RETRO_DEVICE_MOUSE, 0, RETRO_DEVICE_ID_MOUSE_LEFT, "Pointer Primary"},
		{0, RETRO_DEVICE_MOUSE, 0, RETRO_DEVICE_ID_MOUSE_RIGHT, "Pointer Secondary"},
		{0, RETRO_DEVICE_MOUSE, 0, RETRO_DEVICE_ID_MOUSE_MIDDLE, "Pointer Aux"},
		{0, RETRO_DEVICE_MOUSE, 0, RETRO_DEVICE_ID_MOUSE_BUTTON_4, "Pointer Back"},
		{0, RETRO_DEVICE_MOUSE, 0, RETRO_DEVICE_ID_MOUSE_BUTTON_5, "Pointer Forward"},
		{0, RETRO_DEVICE_POINTER, 0, RETRO_DEVICE_ID_POINTER_X, "Pointer X"},
		{0, RETRO_DEVICE_POINTER, 0, RETRO_DEVICE_ID_POINTER_Y, "Pointer Y"},
		{0, 0, 0, 0, nullptr}};
	cb(RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS, (void*)input_desc);

	set_core_options(BMSX_ENABLE_GLES2);
}

void retro_set_video_refresh(retro_video_refresh_t cb) {
	video_cb = cb;
}

void retro_set_audio_sample(retro_audio_sample_t cb) { audio_cb = cb; }

void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {
	audio_batch_cb = cb;
}

void retro_set_input_poll(retro_input_poll_t cb) {
	input_poll_cb = cb;
	if (g_input) {
		g_input->setInputPollCallback(cb);
	}
}

void retro_set_input_state(retro_input_state_t cb) {
	input_state_cb = cb;
	if (g_input) {
		g_input->setInputStateCallback(cb);
	}
}

static void sync_runtime_timing(bmsx::Runtime& runtime) {
	if (runtime.timing.ufpsScaled == g_runtime_ufps_scaled) {
		return;
	}
	g_runtime_ufps_scaled = runtime.timing.ufpsScaled;
	g_input->setFrameDurationMs(runtime.timing.frameDurationMs);
	g_audio_output->setEmulationFrameTimeSec(
		static_cast<bmsx::f64>(bmsx::HZ_SCALE)
		/ static_cast<bmsx::f64>(g_runtime_ufps_scaled));
}

static void activate_runtime(bmsx::Runtime& runtime) {
	g_runtime_reset_completed = false;
	runtime.onStateReset = [] { g_runtime_reset_completed = true; };
#if BMSX_ENABLE_GLES2
	g_gles_frame_worker.reset();
	const char* threaded = std::getenv("BMSX_GLES2_THREADED");
	if (g_active_backend == bmsx::BackendType::OpenGLES2 && threaded != nullptr && std::strcmp(threaded, "1") == 0) {
		g_gles_frame_worker = std::make_unique<bmsx::GlesFrameWorker>(runtime,
			*g_video_presenter, *g_input, *g_presentation, *g_overlay_menu, g_single_guest_tick);
		logging.log(RETRO_LOG_INFO, "[BMSX] Threaded GLES submission enabled\n");
	}
#endif
	g_rewind.emplace(runtime, *g_video_presenter, *g_presentation);
	const bool recordRewind = read_toggle_option(kOptionRewindRecording, "Rewind Recording", kDefaultRewindRecording);
	g_rewind->setRecordingEnabled(recordRewind);
	g_input->setGamepadHoldAction(read_gamepad_hold_action());
	logging.log(RETRO_LOG_INFO, "[BMSX] Rewind recording %s\n", recordRewind ? "enabled" : "disabled");
	g_audio_output->resetPlayback();
	g_presentation->reset(*g_video_presenter, runtime);
	sync_runtime_timing(runtime);
	runtime.frameScheduler.clearQueuedTime();
	bmsx::flushLibretroSystemOutput(runtime, logging);
}

// The scheduler may run on the GLES frame worker. Replace presentation
// and rewind attachments only after control returns to the frontend.
static bool publish_runtime_reset(bmsx::Runtime& runtime) {
	if (!g_runtime_reset_completed) return false;
#if BMSX_ENABLE_GLES2
	if (isHardwareBackendActive())
		static_cast<bmsx::OpenGLES2Backend&>(g_video_presenter->backend()).invalidateContextState();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	runtime.machine.cpu.prepareSystemNativeCode();
#endif
	activate_runtime(runtime);
	logging.log(RETRO_LOG_INFO, "[BMSX] Game reset (runtime rebooted)\n");
	return true;
}

static void unload_content() {
#if BMSX_ENABLE_GLES2
	g_gles_frame_worker.reset();
#endif
	const bool wasLoaded = g_content != nullptr;
	if (wasLoaded) {
		g_input->reset();
		g_overlay_menu->resetInputState(*g_input, *g_rewind);
		g_presentation->clearPresentation();
	}
	g_rewind.reset();
	g_content.reset();
	g_runtime_ufps_scaled = 0;
	if (wasLoaded) {
		logging.log(RETRO_LOG_INFO, "[BMSX] ROM unloaded\n");
	}
}

static bool load_default_content() {
	unload_content();
	g_content = bmsx::loadLibretroContent(
		g_system_dir,
		{},
		*g_input,
		logging);
	if (!g_content) return false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	g_content->runtime.machine.cpu.setNativeCompilationProfiling(g_profile_native_compilation);
#endif
	activate_runtime(g_content->runtime);
	logging.log(RETRO_LOG_INFO, "[BMSX] Booted system ROM firmware\n");
	return true;
}

static bool load_content_from_paths(
	const std::array<std::string, bmsx::CARTRIDGE_SLOT_COUNT>& paths
) {
	unload_content();
	g_content = bmsx::loadLibretroContent(
		g_system_dir,
		paths,
		*g_input,
		logging);
	if (!g_content) return false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	g_content->runtime.machine.cpu.setNativeCompilationProfiling(g_profile_native_compilation);
#endif
	activate_runtime(g_content->runtime);
	return true;
}

static void reset_hardware_context() {
#if BMSX_ENABLE_GLES2
	auto& presenter = *g_video_presenter;
	auto& backend = static_cast<bmsx::OpenGLES2Backend&>(presenter.backend());
	logging.log(RETRO_LOG_INFO, "[BMSX] onContextReset: begin\n");
	backend.resizePresentationTarget(
		static_cast<bmsx::i32>(presenter.canvasSize.x),
		static_cast<bmsx::i32>(presenter.canvasSize.y));
	backend.onContextReset();
	logging.log(RETRO_LOG_INFO, "[BMSX] onContextReset: rebuild render graph\n");
	presenter.installRenderPipeline(
		std::make_unique<bmsx::RenderPassLibrary>(&backend, &presenter));
	logging.log(RETRO_LOG_INFO, "[BMSX] onContextReset: refresh render surfaces\n");
	presenter.initializeDefaultTextures();
	logging.log(RETRO_LOG_INFO, "[BMSX] onContextReset: done\n");
#else
	throw BMSX_RUNTIME_ERROR("OpenGLES2 backend disabled at compile time.");
#endif
}

static void destroy_hardware_context() {
#if BMSX_ENABLE_GLES2
	auto& presenter = *g_video_presenter;
	auto& backend = static_cast<bmsx::OpenGLES2Backend&>(presenter.backend());
	backend.invalidateContextState();
	backend.captureGxGpuVramSnapshot(g_content->runtime.machine.gxGpu);
	presenter.releaseRenderPipeline();
	presenter.clearTextures();
	backend.onContextDestroy();
#else
	throw BMSX_RUNTIME_ERROR("OpenGLES2 backend disabled at compile time.");
#endif
}

static void lose_hardware_context() {
#if BMSX_ENABLE_GLES2
	auto& presenter = *g_video_presenter;
	auto& backend = static_cast<bmsx::OpenGLES2Backend&>(presenter.backend());
	backend.onContextLost();
	presenter.releaseRenderPipeline();
	presenter.clearTextures();
#else
	throw BMSX_RUNTIME_ERROR("OpenGLES2 backend disabled at compile time.");
#endif
}

/* ============================================================================
 * Core lifecycle
 * ============================================================================
 */

void retro_init(void) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
	bmsx::resetLibretroNativeGateProfile();
#endif
	logging.log(RETRO_LOG_INFO, "[BMSX] retro_init\n");
	g_single_guest_tick = false;
	environ_cb(BMSX_ENVIRONMENT_GET_SINGLE_GUEST_TICK_V1, &g_single_guest_tick);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	BmsxNativeCompilationProfileInterfaceV2 nativeCompilationProfile{read_native_compilation_profile};
	g_profile_native_compilation = environ_cb(BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE_V2,
		&nativeCompilationProfile);
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	BmsxExecutionProfileInterface executionProfile{read_execution_profile};
	environ_cb(BMSX_ENVIRONMENT_SET_EXECUTION_PROFILE_INTERFACE, &executionProfile);
#endif
	const RenderBackendPreference preference = read_backend_preference();
	const bmsx::BackendType desired_backend = resolve_backend_preference(preference);
	g_crt_postprocessing_enabled = read_crt_postprocessing_enabled();
	g_crt_noise_enabled = read_crt_noise_enabled();
	g_crt_color_bleed_enabled = read_crt_color_bleed_enabled();
	g_crt_scanlines_enabled = read_crt_scanlines_enabled();
	g_crt_blur_enabled = read_crt_blur_enabled();
	g_crt_glow_enabled = read_crt_glow_enabled();
	g_crt_fringing_enabled = read_crt_fringing_enabled();
	g_crt_aperture_enabled = read_crt_aperture_enabled();
	g_device_quantize_mode = read_device_quantize_mode();
	g_resource_usage_gizmo_enabled = read_resource_usage_gizmo_enabled();
	g_backend_preference = preference;
	g_active_backend = desired_backend;
	request_hw_context_for_backend(desired_backend);
#if BMSX_ENABLE_GLES2
	const bool profile_gx_uploads =
		offerGxUploadProfileInterface(environ_cb);
#endif
	set_core_options(BMSX_ENABLE_GLES2);

	const char* system_dir = nullptr;
	if (environ_cb(RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY, &system_dir) && system_dir && system_dir[0]) {
		g_system_dir = system_dir;
		logging.log(RETRO_LOG_INFO, "[BMSX] System directory: %s\n", g_system_dir.c_str());
	} else {
		g_system_dir.clear();
		logging.log(RETRO_LOG_INFO, "[BMSX] System directory not provided\n");
	}
	if (!isHardwareBackendActive()) {
		const bmsx::BackendType desired_backend = resolve_backend_preference(g_backend_preference);
		if (is_hardware_backend(desired_backend)) {
			if (g_hw_context_lifecycle != HardwareContextLifecycle::Fatal) {
				const std::string reason =
					std::string("[BMSX] ") + backend_label(desired_backend) +
					" hardware backend was requested but not initialized.";
				fail_hardware_backend(desired_backend, reason.c_str());
			}
		} else {
			logging.log(RETRO_LOG_INFO,
						"[BMSX] Software backend selected via core option\n");
		}
	}

	g_video_output.resetAvInfo();
	g_current_ufps_scaled = bmsx::GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED;

	g_input = std::make_unique<bmsx::LibretroInput>(g_supervisor_request_line_cb);
	g_input->setInputPollCallback(input_poll_cb);
	g_input->setInputStateCallback(input_state_cb);
	BmsxInputLifecycleInterfaceV1 lifecycle{cancel_keyboard_input, cancel_gamepad_input};
	environ_cb(BMSX_ENVIRONMENT_SET_INPUT_LIFECYCLE_INTERFACE_V1, &lifecycle);
	retro_rumble_interface rumbleInterface{};
	environ_cb(RETRO_ENVIRONMENT_GET_RUMBLE_INTERFACE, &rumbleInterface);
	g_input->installRumbleInterface(rumbleInterface);
	g_audio_output = std::make_unique<bmsx::LibretroAudioOutput>();

	const bmsx::i32 viewportWidth = static_cast<bmsx::i32>(
		bmsx::gxGpuDisplayModeScreenWidth(bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD));
	const bmsx::i32 viewportHeight = bmsx::gxGpuVerticalVisibleLines(
		bmsx::GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
		bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD);
	std::unique_ptr<bmsx::GPUBackend> backend;
	switch (g_active_backend) {
		case bmsx::BackendType::OpenGLES2: {
#if BMSX_ENABLE_GLES2
#if defined(BMSX_PLATFORM_SNESMINI)
			auto targetMode = bmsx::GxGpuDrawTargetMode::SmallNibbles;
#else
			auto targetMode = bmsx::GxGpuDrawTargetMode::FullVram;
#endif
			if (const char* target = std::getenv("BMSX_GLES2_TARGETS")) {
				if (std::strcmp(target, "nibbles") == 0) targetMode = bmsx::GxGpuDrawTargetMode::SmallNibbles;
				else if (std::strcmp(target, "rgb5") == 0) targetMode = bmsx::GxGpuDrawTargetMode::SmallRgb5;
#if defined(BMSX_PLATFORM_SNESMINI)
				else if (std::strcmp(target, "rgb5-mali") == 0) targetMode = bmsx::GxGpuDrawTargetMode::SmallRgb5Mali;
#endif
				else if (std::strcmp(target, "full") != 0) throw std::runtime_error("Unknown BMSX_GLES2_TARGETS mode");
			}
			backend = std::make_unique<bmsx::OpenGLES2Backend>(
				viewportWidth,
				viewportHeight,
				profile_gx_uploads,
				bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes,
				targetMode);
			break;
#else
			throw std::runtime_error("OpenGLES2 backend disabled at compile time.");
#endif
		}
		case bmsx::BackendType::Software: {
			auto softwareBackend = std::make_unique<bmsx::SoftwareBackend>(
				viewportWidth,
				viewportHeight,
				bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
			g_software_target = &softwareBackend->presentationTarget();
			backend = std::move(softwareBackend);
			break;
		}
		default:
			throw std::runtime_error("Unsupported libretro backend.");
	}
	backend->resizePresentationTarget(viewportWidth, viewportHeight);
	g_video_presenter = std::make_unique<bmsx::VideoPresenter>(
		g_video_output,
		std::move(backend),
		viewportWidth,
		viewportHeight);
	g_default_font = std::make_unique<bmsx::Font>();
	g_video_presenter->default_font = g_default_font.get();
	if (g_active_backend == bmsx::BackendType::Software) {
		auto* presenter = g_video_presenter.get();
		auto* activeBackend = &presenter->backend();
		presenter->installRenderPipeline(
			std::make_unique<bmsx::RenderPassLibrary>(activeBackend, presenter));
		presenter->initializeDefaultTextures();
	}
	g_video_presenter->crt_postprocessing_enabled = g_crt_postprocessing_enabled;
	g_video_presenter->applyNoise = g_crt_noise_enabled;
	g_video_presenter->applyColorBleed = g_crt_color_bleed_enabled;
	g_video_presenter->applyScanlines = g_crt_scanlines_enabled;
	g_video_presenter->applyBlur = g_crt_blur_enabled;
	g_video_presenter->applyGlow = g_crt_glow_enabled;
	g_video_presenter->applyFringing = g_crt_fringing_enabled;
	g_video_presenter->applyAperture = g_crt_aperture_enabled;
	g_video_presenter->setDeviceQuantizeMode(g_device_quantize_mode);
	g_video_presenter->showResourceUsageGizmo = g_resource_usage_gizmo_enabled;

	g_keyboard_model.emplace(*g_input, bmsx::NATIVE_KEYBOARD_PAGES);
	g_keyboard_view.emplace(*g_keyboard_model);
	g_keyboard_interaction.emplace(*g_keyboard_model, *g_keyboard_view);
	g_overlay_menu.emplace(*g_input, *g_keyboard_interaction);
	g_presentation.emplace();
	g_total_time = 0.0;
	g_runtime_ufps_scaled = 0;
	if (isHardwareBackendActive()) {
		try {
#if BMSX_ENABLE_GLES2
			static_cast<bmsx::OpenGLES2Backend&>(g_video_presenter->backend())
				.setContextCallbacks(
					g_hw_render.get_current_framebuffer,
					g_hw_render.get_proc_address);
#endif
		} catch (const std::exception& err) {
			logging.log(RETRO_LOG_ERROR,
						"[BMSX] %s setup exception: %s\n",
						backend_label(g_active_backend),
						err.what());
			const std::string reason =
				std::string("[BMSX] ") + backend_label(g_active_backend) +
				" setup failed: " + err.what();
			fail_hardware_backend(g_active_backend, reason.c_str());
		}
	}
	sync_current_av_info(g_current_ufps_scaled);
	// Defer actual context reset to retro_run. Some frontends/devices (notably
	// older embedded hosts) are not stable when heavy GL init work is done
	// directly in the context_reset callback/init path.
}

void retro_deinit(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] retro_deinit\n");
	BmsxInputLifecycleInterfaceV1 lifecycle{};
	environ_cb(BMSX_ENVIRONMENT_SET_INPUT_LIFECYCLE_INTERFACE_V1, &lifecycle);

	unload_content();
	g_presentation.reset();
	g_overlay_menu.reset();
	g_keyboard_interaction.reset();
	g_keyboard_view.reset();
	g_keyboard_model.reset();
	g_video_presenter.reset();
	g_default_font.reset();
	g_audio_output.reset();
	g_input.reset();
	g_software_target = nullptr;
	g_hw_context_lifecycle = HardwareContextLifecycle::Software;
	g_video_output.clearFrontendAvInfo();
}

unsigned retro_api_version(void) { return RETRO_API_VERSION; }

void retro_get_system_info(struct retro_system_info* info) {
	std::memset(info, 0, sizeof(*info));
	info->library_name = CORE_NAME;
	info->library_version = CORE_VERSION;
	info->valid_extensions = VALID_EXTENSIONS;
	info->need_fullpath = true;  // Load ROM from path to avoid duplicate in-memory copy
	info->block_extract = false;  // Allow the frontend to extract archived content.
}

void retro_get_system_av_info(struct retro_system_av_info* info) {
	g_video_output.getSystemAvInfo(*info);

	logging.log(
		RETRO_LOG_INFO,
		"[BMSX] System AV Info requested: %ux%u @ %.2fHz, Sample Rate: %.2fHz\n",
		info->geometry.base_width, info->geometry.base_height, info->timing.fps,
		info->timing.sample_rate);
}

void retro_set_controller_port_device(unsigned port, unsigned device) {
	logging.log(RETRO_LOG_INFO, "[BMSX] Port %u set to device %u\n", port,
				device);
	g_input->setControllerDevice(port, device);
}

/* ============================================================================
 * Game lifecycle
 * ============================================================================
 */

static bool begin_content_load() {
	if (!g_backend_error.empty()) {
		logging.log(RETRO_LOG_ERROR, "%s\n", g_backend_error.c_str());
		return false;
	}
	enum retro_pixel_format pixelFormat = RETRO_PIXEL_FORMAT_XRGB8888;
	if (!environ_cb(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &pixelFormat)) {
		logging.log(RETRO_LOG_ERROR, "XRGB8888 output is not supported by the frontend\n");
		return false;
	}
	return true;
}

static void complete_content_load() {
	sync_current_av_info(g_content->runtime.timing.ufpsScaled);
	retro_keyboard_callback keyboardCallback = { keyboard_event };
	environ_cb(RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK, &keyboardCallback);
}

bool retro_load_game(const struct retro_game_info* game) {
	if (!begin_content_load()) {
		return false;
	}
	bool loaded_ok = false;
	if (!game) {
		logging.log(RETRO_LOG_INFO,
					"[BMSX] No game provided, booting system firmware without a cartridge\n");
		loaded_ok = load_default_content();
	} else if (game->path) {
		logging.log(
			RETRO_LOG_INFO,
			"[BMSX] Loading game: %s\n",
			game->path);
		loaded_ok = load_content_from_paths(
			{ std::string(game->path), std::string{} });
	} else {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Full-path content is required\n");
		return false;
	}
	if (!loaded_ok) {
		return false;
	}

	complete_content_load();
	return true;
}

bool retro_load_game_special(unsigned game_type,
								const struct retro_game_info* info,
								size_t num_info) {
	if (game_type != BMSX_SUBSYSTEM_DUAL_CARTRIDGE
			|| !info
			|| num_info != bmsx::CARTRIDGE_SLOT_COUNT) {
		return false;
	}
	if (!begin_content_load()) {
		return false;
	}
	if (!info[0].path) {
		return false;
	}
	const std::array<std::string, bmsx::CARTRIDGE_SLOT_COUNT> paths{
		info[0].path,
		info[1].path ? info[1].path : "",
	};
	if (!load_content_from_paths(paths)) {
		return false;
	}
	complete_content_load();
	return true;
}

void retro_unload_game(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] Unloading game\n");
	unload_content();
	sync_current_av_info(bmsx::GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
}

/* ============================================================================
 * Emulation
 * ============================================================================
 */

void retro_reset(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] Reset\n");
	if (g_content) {
		g_overlay_menu->resetInputState(*g_input, *g_rewind);
		auto& runtime = g_content->runtime;
		runtime.machine.systemController.requestReset();
		runtime.frameScheduler.runCyclesToNextLogicalTick(runtime, 0);
		publish_runtime_reset(runtime);
	} else if (!load_default_content()) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Reset failed: cartridge-free firmware boot failed\n");
		return;
	}
}

void retro_run(void) {
	const bool retainFrameGrant = g_run_cadence_accepted && g_run_cadence.retain_frame_grant;
	g_run_cadence = {};
#if defined(BMSX_NATIVE_GATE_PROFILE)
	bmsx::NativeGateProfileFrame gateProfile(
		g_content ? &g_content->runtime.machine.cpu : nullptr, logging.log);
#endif
	// Libretro video notifications belong to retro_run. Publishing a change that
	// was queued by reset/state work first lets a synchronous frontend context
	// reset enter the lifecycle switch below in this same frame.
	const auto initialAvInfoNotification = g_video_output.publishPendingAvInfo();
	const bool restoringHardwareContext = g_hw_context_lifecycle == HardwareContextLifecycle::ResetPending;
	switch (g_hw_context_lifecycle) {
		case HardwareContextLifecycle::Software:
		case HardwareContextLifecycle::Ready:
			break;
		case HardwareContextLifecycle::ResetPending: {
			bool contextResetFailed = false;
			try {
				reset_hardware_context();
				g_hw_context_lifecycle = HardwareContextLifecycle::Ready;
			} catch (const std::exception& err) {
				logging.log(RETRO_LOG_ERROR,
							"[BMSX] %s context reset exception: %s\n",
							backend_label(g_active_backend),
							err.what());
				lose_hardware_context();
				const std::string reason =
					std::string("[BMSX] ") + backend_label(g_active_backend) +
					" context reset failed: " + err.what();
				fail_hardware_backend(g_active_backend, reason.c_str());
				environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr);
				contextResetFailed = true;
			}
			if (contextResetFailed) {
				return;
			}
			break;
		}
		case HardwareContextLifecycle::AwaitingReset: {
			const std::string reason =
				std::string("[BMSX] ") + backend_label(g_active_backend) +
				" frontend did not initialize the requested hardware context.";
			fail_hardware_backend(g_active_backend, reason.c_str());
			environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr);
			return;
		}
		case HardwareContextLifecycle::Fatal:
			return;
	}
#if BMSX_ENABLE_GLES2
	if (isHardwareBackendActive())
		static_cast<bmsx::OpenGLES2Backend&>(g_video_presenter->backend()).invalidateContextState();
#endif
	bool vars_updated = false;
	if (environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE, &vars_updated) && vars_updated) {
		const RenderBackendPreference new_preference = read_backend_preference();
		if (new_preference != g_backend_preference) {
			g_backend_preference = new_preference;
			retro_message msg;
			msg.msg = "BMSX: Render backend change requires core restart.";
			msg.frames = 180;
			environ_cb(RETRO_ENVIRONMENT_SET_MESSAGE, &msg);
			logging.log(RETRO_LOG_WARN,
						"[BMSX] Render backend change detected; restart required\n");
		}
		const bool recordRewind = read_toggle_option(kOptionRewindRecording, "Rewind Recording", kDefaultRewindRecording);
		if (!recordRewind && g_overlay_menu->executionMode() == bmsx::HostMenuExecution::Rewind)
			g_overlay_menu->resetInputState(*g_input, *g_rewind);
		g_rewind->setRecordingEnabled(recordRewind);
		g_input->setGamepadHoldAction(read_gamepad_hold_action());
		const bool new_crt = read_crt_postprocessing_enabled();
		if (new_crt != g_crt_postprocessing_enabled) {
			g_crt_postprocessing_enabled = new_crt;
			g_video_presenter->crt_postprocessing_enabled = g_crt_postprocessing_enabled;
		}
		const bool new_crt_noise = read_crt_noise_enabled();
		const bool new_crt_color_bleed = read_crt_color_bleed_enabled();
		const bool new_crt_scanlines = read_crt_scanlines_enabled();
		const bool new_crt_blur = read_crt_blur_enabled();
		const bool new_crt_glow = read_crt_glow_enabled();
		const bool new_crt_fringing = read_crt_fringing_enabled();
		const bool new_crt_aperture = read_crt_aperture_enabled();
		bool crt_effects_changed = false;
		if (new_crt_noise != g_crt_noise_enabled) {
			g_crt_noise_enabled = new_crt_noise;
			crt_effects_changed = true;
		}
		if (new_crt_color_bleed != g_crt_color_bleed_enabled) {
			g_crt_color_bleed_enabled = new_crt_color_bleed;
			crt_effects_changed = true;
		}
		if (new_crt_scanlines != g_crt_scanlines_enabled) {
			g_crt_scanlines_enabled = new_crt_scanlines;
			crt_effects_changed = true;
		}
		if (new_crt_blur != g_crt_blur_enabled) {
			g_crt_blur_enabled = new_crt_blur;
			crt_effects_changed = true;
		}
		if (new_crt_glow != g_crt_glow_enabled) {
			g_crt_glow_enabled = new_crt_glow;
			crt_effects_changed = true;
		}
		if (new_crt_fringing != g_crt_fringing_enabled) {
			g_crt_fringing_enabled = new_crt_fringing;
			crt_effects_changed = true;
		}
		if (new_crt_aperture != g_crt_aperture_enabled) {
			g_crt_aperture_enabled = new_crt_aperture;
			crt_effects_changed = true;
		}
		if (crt_effects_changed) {
			g_video_presenter->applyNoise = g_crt_noise_enabled;
			g_video_presenter->applyColorBleed = g_crt_color_bleed_enabled;
			g_video_presenter->applyScanlines = g_crt_scanlines_enabled;
			g_video_presenter->applyBlur = g_crt_blur_enabled;
			g_video_presenter->applyGlow = g_crt_glow_enabled;
			g_video_presenter->applyFringing = g_crt_fringing_enabled;
			g_video_presenter->applyAperture = g_crt_aperture_enabled;
		}
		const bmsx::DeviceQuantizeMode new_device_quantize_mode = read_device_quantize_mode();
		if (new_device_quantize_mode != g_device_quantize_mode) {
			g_device_quantize_mode = new_device_quantize_mode;
			g_video_presenter->setDeviceQuantizeMode(g_device_quantize_mode);
		}
		const bool new_resource_usage_gizmo = read_resource_usage_gizmo_enabled();
		if (new_resource_usage_gizmo != g_resource_usage_gizmo_enabled) {
			g_resource_usage_gizmo_enabled = new_resource_usage_gizmo;
			g_video_presenter->showResourceUsageGizmo = g_resource_usage_gizmo_enabled;
		}
	}
	const bool hardware_frame = isHardwareBackendActive();
#if BMSX_ENABLE_GLES2
	if (hardware_frame) {
		auto& backend = static_cast<bmsx::OpenGLES2Backend&>(g_video_presenter->backend());
		if (backend.profilesGxUploads()) backend.beginGxUploadProfileFrame();
	}
#endif
	const bmsx::f64 deltaTime = g_frame_time_sec;
	g_input->poll(
		static_cast<bmsx::i32>(g_video_presenter->displayedViewportSize.x),
		static_cast<bmsx::i32>(g_video_presenter->displayedViewportSize.y),
		std::chrono::duration<bmsx::f64, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count());
	bmsx::Runtime& runtime = g_content->runtime;
#if defined(BMSX_DIAGNOSTIC_GEO)
	const auto geoBefore = runtime.machine.geometryController.overlapProfile();
	const auto tickBefore = runtime.frameScheduler.lastTickSequence;
	const auto maintenanceBefore = runtime.frameScheduler.maintenancePulseSequence();
#endif
	bmsx::LibretroFrameResult frameResult = bmsx::LibretroFrameResult::NotPresented;
	try {
		frameResult = bmsx::runLibretroFrame(
			runtime,
			*g_input,
			*g_overlay_menu,
			*g_rewind,
			*g_presentation,
			*g_video_presenter,
			g_total_time,
			deltaTime,
			g_single_guest_tick,
#if BMSX_ENABLE_GLES2
			g_gles_frame_worker.get(),
#else
			nullptr,
#endif
			retainFrameGrant,
			g_run_cadence_accepted && !vars_updated && !restoringHardwareContext
				&& initialAvInfoNotification == bmsx::LibretroAvInfoNotification::None
		);
#if defined(BMSX_DIAGNOSTIC_GEO)
		const auto geo = runtime.machine.geometryController.overlapProfile();
		logging.log(RETRO_LOG_INFO,
			"[GEO] tick=%lld->%lld maintenance=%llu passes=%llu instances=%llu services=%llu pairs=%llu mask_pass=%llu exact=%llu service_cpu_ns=%llu\n",
			static_cast<long long>(tickBefore), static_cast<long long>(runtime.frameScheduler.lastTickSequence),
			static_cast<unsigned long long>(runtime.frameScheduler.maintenancePulseSequence() - maintenanceBefore),
			static_cast<unsigned long long>(geo.passes - geoBefore.passes),
			static_cast<unsigned long long>(geo.instances - geoBefore.instances),
			static_cast<unsigned long long>(geo.services - geoBefore.services),
			static_cast<unsigned long long>(geo.visited - geoBefore.visited),
			static_cast<unsigned long long>(geo.maskPassed - geoBefore.maskPassed),
			static_cast<unsigned long long>(geo.exact - geoBefore.exact),
			static_cast<unsigned long long>(geo.threadNs - geoBefore.threadNs));
#endif
		switch (frameResult) {
			case bmsx::LibretroFrameResult::RebootRequested:
				runtime.machine.systemController.requestReset();
				break;
			case bmsx::LibretroFrameResult::ExitRequested:
			case bmsx::LibretroFrameResult::SuspendRequested: {
				BmsxShutdownReasonV1 reason = frameResult == bmsx::LibretroFrameResult::ExitRequested
					? BMSX_SHUTDOWN_REASON_EXIT_GAME : BMSX_SHUTDOWN_REASON_SUSPEND;
				environ_cb(BMSX_ENVIRONMENT_SET_SHUTDOWN_REASON_V1, &reason);
				environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr);
				break;
			}
			case bmsx::LibretroFrameResult::NotPresented:
			case bmsx::LibretroFrameResult::Presented:
			case bmsx::LibretroFrameResult::Maintenance:
				break;
		}
		if (publish_runtime_reset(runtime)) frameResult = bmsx::LibretroFrameResult::NotPresented;
	} catch (const std::exception& error) {
		bmsx::reportLibretroRuntimeError(
			runtime,
			g_content->systemRomImage,
			g_content->cartridgePackages,
			error.what(),
			logging);
	} catch (...) {
		bmsx::reportLibretroRuntimeError(
			runtime,
			g_content->systemRomImage,
			g_content->cartridgePackages,
			"Unhandled host frame exception.",
			logging);
	}
	bmsx::flushLibretroSystemOutput(runtime, logging);
	sync_runtime_timing(runtime);
	const bmsx::HostMenuExecution menuExecution = g_overlay_menu->executionMode();
	const bool audioMuted = menuExecution == bmsx::HostMenuExecution::Paused
		|| (menuExecution == bmsx::HostMenuExecution::Rewind && !g_rewind->playing())
		|| g_rewind->audioMuted() || (
		runtime.machine.memory.readIoU32(bmsx::IO_SYS_STATUS)
		& bmsx::SYS_STATUS_SUPERVISOR_ACTIVE
	) != 0u;
	const bool audioMuteChanged = g_audio_output->setMuted(
		runtime.machine.audioController,
		audioMuted
	);
	g_audio_output->collectFrame(runtime.machine.audioController);
	if (audioMuteChanged) {
		g_set_audio_transport_suspended_cb(audioMuted);
	}
	const bool video_frame_presented =
		frameResult == bmsx::LibretroFrameResult::Presented;
	const int64_t runtime_ufps_scaled = runtime.timing.ufpsScaled;
	const bool timing_changed = runtime_ufps_scaled != g_current_ufps_scaled;
	if (timing_changed) {
		sync_current_av_info(runtime_ufps_scaled);
	}
	const bmsx::LibretroAvInfoNotification av_info_notification = g_video_output.publishPendingAvInfo();
	const bool suppress_hardware_frame =
		hardware_frame && av_info_notification == bmsx::LibretroAvInfoNotification::System;

	// Output video
	const bool publish_video_frame =
		video_frame_presented && !suppress_hardware_frame;
	g_run_cadence.maintenance_only = g_run_cadence_accepted
		&& frameResult == bmsx::LibretroFrameResult::Maintenance
		&& !vars_updated && !restoringHardwareContext && !timing_changed
		&& initialAvInfoNotification == bmsx::LibretroAvInfoNotification::None
		&& av_info_notification == bmsx::LibretroAvInfoNotification::None;
	if (!g_run_cadence.maintenance_only) {
		if (hardware_frame) {
			const auto& geometry = g_video_output.avInfo().geometry;
			video_cb(
				publish_video_frame ? RETRO_HW_FRAME_BUFFER_VALID : nullptr,
				geometry.base_width,
				geometry.base_height,
				0);
		} else {
			const auto& framebuffer = *g_software_target;
			video_cb(
				publish_video_frame ? framebuffer.data() : nullptr,
				static_cast<unsigned>(framebuffer.width()),
				static_cast<unsigned>(framebuffer.height()),
				static_cast<size_t>(framebuffer.pitch()));
		}
	}

	// Output audio
	const auto& audio = *g_audio_output;
	if (audio_batch_cb && audio.frameCount() > 0u) {
		audio_batch_cb(audio.data(), audio.frameCount());
	}
}

/* ============================================================================
 * Serialization (save states)
 * ============================================================================
 */

size_t retro_serialize_size(void) {
	return g_content ? bmsx::libretroStateSize(g_content->runtime) : 0u;
}

bool retro_serialize(void* data, size_t size) {
	if (!g_content) {
		return false;
	}
	bool serialized = false;
	try {
#if BMSX_ENABLE_GLES2
		if (isHardwareBackendActive())
			static_cast<bmsx::OpenGLES2Backend&>(g_video_presenter->backend()).invalidateContextState();
#endif
		g_video_presenter->backend().captureGxGpuVramSnapshot(
			g_content->runtime.machine.gxGpu);
		serialized = bmsx::serializeLibretroState(
			*g_content,
			std::span<bmsx::u8>(static_cast<bmsx::u8*>(data), size));
	} catch (const std::exception& error) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Save state failed: %s\n",
			error.what());
	}
	return serialized;
}

bool retro_unserialize(const void* data, size_t size) {
	if (!g_content) {
		return false;
	}
	bool restored = false;
	try {
		restored = bmsx::unserializeLibretroState(
			*g_content,
			std::span<const bmsx::u8>(
				static_cast<const bmsx::u8*>(data),
				size));
		if (restored) {
			g_audio_output->resetPlayback();
			auto& runtime = g_content->runtime;
			const auto& scanout = runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout;
			if (scanout.outputActive) {
				const auto width = static_cast<bmsx::i32>(scanout.outputWidth);
				const auto height = static_cast<bmsx::i32>(scanout.outputHeight);
				g_video_output.stageDisplaySize(width, height, width, height);
			}
			sync_current_av_info(runtime.timing.ufpsScaled);
			sync_runtime_timing(runtime);
			g_presentation->requestRestoredPresentation();
		}
	} catch (const std::exception& error) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Load state failed: %s\n",
			error.what());
	}
	return restored;
}

/* ============================================================================
 * Cheats
 * ============================================================================
 */

void retro_cheat_reset(void) {}

void retro_cheat_set(unsigned, bool, const char*) {}

/* ============================================================================
 * Memory access
 * ============================================================================
 */

unsigned retro_get_region(void) {
	// Cartridges are regionless. Dynamic PCRTC timing is published through AV info.
	return RETRO_REGION_PAL;
}

// A flat writable view bypasses the bus and its code/rewind write watches,
// and overlaps the language runtime's private records.
void* retro_get_memory_data(unsigned) {
	return nullptr;
}

size_t retro_get_memory_size(unsigned) {
	return 0;
}

/* ============================================================================
 * Utility
 * ============================================================================
 */

static void fallback_log(enum retro_log_level level, const char* fmt, ...) {
	(void)level;
	va_list args;
	va_start(args, fmt);
	vfprintf(stderr, fmt, args);
	va_end(args);
}

static void hw_context_reset() {
	logging.log(RETRO_LOG_INFO, "[BMSX] hw_context_reset called\n");
	switch (g_hw_context_lifecycle) {
		case HardwareContextLifecycle::AwaitingReset:
		case HardwareContextLifecycle::ResetPending:
			g_hw_context_lifecycle = HardwareContextLifecycle::ResetPending;
			return;
		case HardwareContextLifecycle::Ready: {
			// Libretro omits context_destroy only when the old context is already dead.
			// Retired GX commands cannot reconstruct newer GPU-only VRAM from the last snapshot.
			lose_hardware_context();
			const std::string reason =
				std::string("[BMSX] ") + backend_label(g_active_backend) +
				" context was lost before guest VRAM could be checkpointed.";
			fail_hardware_backend(g_active_backend, reason.c_str());
			environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr);
			return;
		}
		case HardwareContextLifecycle::Software:
		case HardwareContextLifecycle::Fatal:
			return;
	}
}

static void hw_context_destroy() {
	logging.log(RETRO_LOG_INFO, "[BMSX] hw_context_destroy called\n");
	switch (g_hw_context_lifecycle) {
		case HardwareContextLifecycle::Ready:
			destroy_hardware_context();
			g_hw_context_lifecycle = HardwareContextLifecycle::AwaitingReset;
			return;
		case HardwareContextLifecycle::ResetPending:
			g_hw_context_lifecycle = HardwareContextLifecycle::AwaitingReset;
			return;
		case HardwareContextLifecycle::Software:
		case HardwareContextLifecycle::AwaitingReset:
		case HardwareContextLifecycle::Fatal:
			return;
	}
}
