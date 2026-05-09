/*
 * entry.cpp - Libretro core entry points
 *
 * This file implements all the required libretro callbacks that RetroArch
 * uses to communicate with the BMSX console core.
 */

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cstdint>
#include <chrono>
#include <exception>
#include <limits>
#include <stdexcept>
#include <string>
#include <cctype>

#include "libretro.h"
#include "platform.h"
#include "core/taskgate.h"
#include "core/console.h"
#include "core/system.h"
#include "machine/runtime/timing/constants.h"
#include "../../machine/runtime/runtime.h"

// Core info
static constexpr const char* CORE_NAME = "BMSX";
static constexpr const char* CORE_VERSION = "1.0.0";
static constexpr const char* VALID_EXTENSIONS = "rom|bmsx";

// Libretro callbacks
static retro_environment_t environ_cb = nullptr;
static retro_video_refresh_t video_cb = nullptr;
static retro_audio_sample_t audio_cb = nullptr;
static retro_audio_sample_batch_t audio_batch_cb = nullptr;
static retro_input_poll_t input_poll_cb = nullptr;
static retro_input_state_t input_state_cb = nullptr;
static retro_log_callback logging;
static retro_usec_t g_pending_frame_time_usec = 0;
static bool g_has_pending_frame_time = false;

extern "C" void bmsx_set_frame_time_usec(retro_usec_t usec);

static void libretro_frame_time_callback(retro_usec_t usec) {
	bmsx_set_frame_time_usec(usec);
}
extern "C" RETRO_API void bmsx_keyboard_event(const char* code, bool down);
extern "C" RETRO_API void bmsx_keyboard_reset(void);
extern "C" RETRO_API void bmsx_focus_changed(bool focused);
extern "C" RETRO_API bool bmsx_is_cart_program_active(void);
extern "C" int64_t bmsx_get_ufps(void);

static retro_hw_render_callback g_hw_render;
static bool g_hw_render_supported = false;
static bool g_hw_render_requested = false;
static bool g_hw_context_pending = false;
static bool g_hw_context_ready = false;
static bmsx::BackendType g_active_backend = bmsx::BackendType::Software;
static bmsx::BackendType g_hw_render_backend = bmsx::BackendType::Software;
static TaskGate g_task_gate;
static GateGroup g_backend_gate = g_task_gate.group("libretro-backend");
static GateToken g_backend_fallback_token;
static GateToken g_backend_option_pending_token;
static GateToken g_backend_option_failed_token;
static std::string g_hw_render_failure_reason;
static std::string g_system_dir;

static std::string sanitizeSystemDir(std::string_view path) {
	size_t start = 0;
	size_t end = path.size();
	while (start < end && std::isspace(static_cast<unsigned char>(path[start]))) {
		++start;
	}
	while (end > start && std::isspace(static_cast<unsigned char>(path[end - 1]))) {
		--end;
	}
	if (end - start >= 2) {
		const char first = path[start];
		const char last = path[end - 1];
		if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
			++start;
			--end;
		}
	}
	return std::string(path.substr(start, end - start));
}

// The platform instance
static bmsx::LibretroPlatform* g_platform = nullptr;
static retro_system_av_info g_cached_av_info{};
static bool g_cached_av_info_valid = false;

static void apply_manifest_av_info(retro_system_av_info& av, const bmsx::MachineManifest& manifest, int64_t ufps_scaled) {
	av.geometry.base_width = static_cast<unsigned>(manifest.viewportWidth);
	av.geometry.base_height = static_cast<unsigned>(manifest.viewportHeight);
	if (av.geometry.max_width < av.geometry.base_width) {
		av.geometry.max_width = av.geometry.base_width;
	}
	if (av.geometry.max_height < av.geometry.base_height) {
		av.geometry.max_height = av.geometry.base_height;
	}
	av.geometry.aspect_ratio = static_cast<float>(av.geometry.base_width)
		/ static_cast<float>(av.geometry.base_height);
	av.timing.fps = static_cast<double>(ufps_scaled) / static_cast<double>(bmsx::HZ_SCALE);
}

static void initialize_default_av_info(retro_system_av_info& av) {
	std::memset(&av, 0, sizeof(av));
	av.timing.sample_rate = bmsx::DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE;
	apply_manifest_av_info(av, bmsx::defaultSystemMachineManifest(), bmsx::DEFAULT_UFPS_SCALED);
}

extern "C" RETRO_API void bmsx_keyboard_event(const char* code, bool down) {
	if (!g_platform || !code || !code[0]) {
		return;
	}
	g_platform->postKeyboardEvent(code, down);
}

extern "C" RETRO_API void bmsx_keyboard_reset(void) {
	if (!g_platform) {
		return;
	}
	g_platform->clearKeyboardState();
}

extern "C" RETRO_API void bmsx_focus_changed(bool focused) {
	if (!g_platform) {
		return;
	}
	g_platform->notifyFocusChange(focused);
}

extern "C" RETRO_API bool bmsx_is_cart_program_active(void) {
	// disable-next-line or_nil_fallback_pattern -- libretro may query this before platform creation; nullptr is the external host boundary.
	auto* console = g_platform ? g_platform->console() : nullptr;
	return console && console->hasRuntime() && console->runtime().isCartProgramStarted();
}

static constexpr const char* kOptionRenderBackend = "bmsx_render_backend";
static constexpr const char* kRenderBackendSoftware = "software";
static constexpr const char* kRenderBackendGLES2 = "gles2";
static constexpr const char* kOptionCrtPostprocessing = "bmsx_crt_postprocessing";
static constexpr const char* kCrtPostprocessingOff = "off";
static constexpr const char* kCrtPostprocessingOn = "on";
static constexpr const char* kOptionPostprocessDetail = "bmsx_postprocess_detail";
static constexpr const char* kPostprocessDetailOff = "off";
static constexpr const char* kPostprocessDetailOn = "on";
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
static constexpr const char* kDitherOff = "off";
static constexpr const char* kDitherPSX = "psx";
static constexpr const char* kDitherRGB777Output = "rgb777_output";
static constexpr const char* kDitherMSX10 = "msx10";

enum class RenderBackendPreference {
	Auto,
	Software,
	GLES2
};

static RenderBackendPreference g_backend_preference = RenderBackendPreference::Auto;
static bool g_crt_postprocessing_enabled = true;
static bool g_postprocess_detail_enabled = false;
static bool g_crt_noise_enabled = true;
static bool g_crt_color_bleed_enabled = true;
static bool g_crt_scanlines_enabled = true;
static bool g_crt_blur_enabled = true;
static bool g_crt_glow_enabled = true;
static bool g_crt_fringing_enabled = true;
static bool g_crt_aperture_enabled = false;
static int g_dither_type = 0;
static bool g_resource_usage_gizmo_enabled = false;

static retro_core_option_v2_category g_option_categories_us[] = {
	{"video", "Video", "Video settings."},
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
		kOptionPostprocessDetail,
		"Post-processing Detail",
		"Post-processing Detail",
		"Increase post-processing detail (higher offscreen scale).",
		"Increase post-processing detail (higher offscreen scale).",
		"video",
		{
			{kPostprocessDetailOff, "Off"},
			{kPostprocessDetailOn, "On"},
			{nullptr, nullptr},
		},
		kPostprocessDetailOff
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
		"Dither",
		"Dither",
		"Select dithering mode.",
		"Select dithering mode.",
		"video",
		{
			{kDitherOff, "Off"},
			{kDitherPSX, "PSX RGB555"},
			{kDitherRGB777Output, "RGB777 Output"},
			{kDitherMSX10, "MSX10 3:4:3"},
			{nullptr, nullptr},
		},
		kDitherOff
	},
	{
		kOptionHostShowUsageGizmo,
		"Show Usage Gizmo",
		"Show Usage Gizmo",
		"Toggle the CPU/RAM/VRAM/VDP usage overlay.",
		"Toggle the CPU/RAM/VRAM/VDP usage overlay.",
		"video",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
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
		kOptionPostprocessDetail,
		"Post-processing Detail",
		"Increase post-processing detail (higher offscreen scale).",
		{
			{kPostprocessDetailOff, "Off"},
			{kPostprocessDetailOn, "On"},
			{nullptr, nullptr},
		},
		kPostprocessDetailOff
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
		"Dither",
		"Select dithering mode.",
		{
			{kDitherOff, "Off"},
			{kDitherPSX, "PSX RGB555"},
			{kDitherRGB777Output, "RGB777 Output"},
			{kDitherMSX10, "MSX10 3:4:3"},
			{nullptr, nullptr},
		},
		kDitherOff
	},
	{
		kOptionHostShowUsageGizmo,
		"Show Usage Gizmo",
		"Toggle the CPU/RAM/VRAM/VDP usage overlay.",
		{
			{kToggleOff, "Off"},
			{kToggleOn, "On"},
			{nullptr, nullptr},
		},
		kToggleOff
	},
	{nullptr, nullptr, nullptr, {{nullptr, nullptr}}, nullptr}
};

static char g_option_render_backend_var[128] = {};
static char g_option_crt_postprocessing_var[128] = {};
static char g_option_postprocess_detail_var[128] = {};
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
	{kOptionPostprocessDetail, nullptr},
	{kOptionCrtNoise, nullptr},
	{kOptionCrtColorBleed, nullptr},
	{kOptionCrtScanlines, nullptr},
	{kOptionCrtBlur, nullptr},
	{kOptionCrtGlow, nullptr},
	{kOptionCrtFringing, nullptr},
	{kOptionCrtAperture, nullptr},
	{kOptionDither, nullptr},
	{kOptionHostShowUsageGizmo, nullptr},
	{nullptr, nullptr}
};

// Forward declarations
static void fallback_log(enum retro_log_level level, const char* fmt, ...);
static void hw_context_reset();
static void hw_context_destroy();
static void set_core_options(bool default_gles2);
static RenderBackendPreference read_backend_preference();
static RenderBackendPreference parse_backend_preference(const char* value);
static bmsx::BackendType resolve_backend_preference(RenderBackendPreference preference);
static bool is_hardware_backend(bmsx::BackendType type);
static const char* backend_label(bmsx::BackendType type);
static void apply_backend_preference(RenderBackendPreference preference);
static void handle_backend_fallback(bmsx::BackendType backend, const char* reason);
static void try_update_backend_option();
static bool read_crt_postprocessing_enabled();
static bool read_postprocess_detail_enabled();
static bool read_crt_noise_enabled();
static bool read_crt_color_bleed_enabled();
static bool read_crt_scanlines_enabled();
static bool read_crt_blur_enabled();
static bool read_crt_glow_enabled();
static bool read_crt_fringing_enabled();
static bool read_crt_aperture_enabled();
static int read_dither_type();
static bool read_toggle_option(const char* key, const char* label, bool default_value);
static bool read_resource_usage_gizmo_enabled();

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
	return is_hardware_backend(g_active_backend);
}

static void try_update_backend_option() {
	if (!g_backend_option_pending_token.active) {
		return;
	}
	retro_variable var;
	var.key = kOptionRenderBackend;
	var.value = kRenderBackendSoftware;
	if (environ_cb(RETRO_ENVIRONMENT_SET_VARIABLE, &var)) {
		g_backend_gate.end(g_backend_option_pending_token);
		if (g_backend_option_failed_token.active) {
			g_backend_gate.end(g_backend_option_failed_token);
		}
		return;
	}
	if (!g_backend_option_failed_token.active) {
		GateScope scope;
		scope.category = "option-update";
		scope.tag = "set-variable-failed";
		g_backend_gate.ensure(g_backend_option_failed_token, true, scope);
		logging.log(RETRO_LOG_WARN,
					"[BMSX] Failed to update core option '%s' to software\n",
					kOptionRenderBackend);
	}
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
	set_toggle(9, allow_crt);

	set_default(1, kCrtPostprocessingOff);
	set_default(2, kPostprocessDetailOff);
	set_default(3, kToggleOff);
	set_default(4, kToggleOff);
	set_default(5, kToggleOff);
	set_default(6, kToggleOff);
	set_default(7, kToggleOff);
	set_default(8, kToggleOff);
	set_default(9, kToggleOff);
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
	g_option_defs_us[2].values[0] = {kPostprocessDetailOff, "Off"};
	g_option_defs_us[2].values[1] = {kPostprocessDetailOn, "On"};
	g_option_defs_us[2].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[2].values[0] = {kPostprocessDetailOff, "Off"};
	g_option_defs_v1_us[2].values[1] = {kPostprocessDetailOn, "On"};
	g_option_defs_v1_us[2].values[2] = {nullptr, nullptr};

	const bool crt_readonly = false;
	set_crt_option_values(true);

	g_option_defs_us[10].default_value = kDitherOff;
	g_option_defs_v1_us[10].default_value = kDitherOff;
	g_option_defs_us[10].values[0] = {kDitherOff, "Off"};
	g_option_defs_us[10].values[1] = {kDitherPSX, "PSX RGB555"};
	g_option_defs_us[10].values[2] = {kDitherRGB777Output, "RGB777 Output"};
	g_option_defs_us[10].values[3] = {kDitherMSX10, "MSX10 3:4:3"};
	g_option_defs_us[10].values[4] = {nullptr, nullptr};
	g_option_defs_v1_us[10].values[0] = {kDitherOff, "Off"};
	g_option_defs_v1_us[10].values[1] = {kDitherPSX, "PSX RGB555"};
	g_option_defs_v1_us[10].values[2] = {kDitherRGB777Output, "RGB777 Output"};
	g_option_defs_v1_us[10].values[3] = {kDitherMSX10, "MSX10 3:4:3"};
	g_option_defs_v1_us[10].values[4] = {nullptr, nullptr};

	g_option_defs_us[11].default_value = kToggleOff;
	g_option_defs_v1_us[11].default_value = kToggleOff;
	g_option_defs_us[11].values[0] = {kToggleOff, "Off"};
	g_option_defs_us[11].values[1] = {kToggleOn, "On"};
	g_option_defs_us[11].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[11].values[0] = {kToggleOff, "Off"};
	g_option_defs_v1_us[11].values[1] = {kToggleOn, "On"};
	g_option_defs_v1_us[11].values[2] = {nullptr, nullptr};

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
	std::snprintf(g_option_postprocess_detail_var, sizeof(g_option_postprocess_detail_var),
					crt_readonly ? "Post-processing Detail; %s" : "Post-processing Detail; %s|%s",
					kPostprocessDetailOff, kPostprocessDetailOn);
	g_option_vars[2].value = g_option_postprocess_detail_var;
	std::snprintf(g_option_crt_noise_var, sizeof(g_option_crt_noise_var),
					crt_readonly ? "CRT Noise; %s" : "CRT Noise; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[3].value = g_option_crt_noise_var;
	std::snprintf(g_option_crt_color_bleed_var, sizeof(g_option_crt_color_bleed_var),
					crt_readonly ? "CRT Color Bleed; %s" : "CRT Color Bleed; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[4].value = g_option_crt_color_bleed_var;
	std::snprintf(g_option_crt_scanlines_var, sizeof(g_option_crt_scanlines_var),
					crt_readonly ? "CRT Scanlines; %s" : "CRT Scanlines; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[5].value = g_option_crt_scanlines_var;
	std::snprintf(g_option_crt_blur_var, sizeof(g_option_crt_blur_var),
					crt_readonly ? "CRT Blur; %s" : "CRT Blur; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[6].value = g_option_crt_blur_var;
	std::snprintf(g_option_crt_glow_var, sizeof(g_option_crt_glow_var),
					crt_readonly ? "CRT Glow; %s" : "CRT Glow; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[7].value = g_option_crt_glow_var;
	std::snprintf(g_option_crt_fringing_var, sizeof(g_option_crt_fringing_var),
					crt_readonly ? "CRT Fringing; %s" : "CRT Fringing; %s|%s",
					kToggleOn, kToggleOff);
	g_option_vars[8].value = g_option_crt_fringing_var;
	std::snprintf(g_option_crt_aperture_var, sizeof(g_option_crt_aperture_var),
					crt_readonly ? "CRT Aperture; %s" : "CRT Aperture; %s|%s",
					kToggleOff, kToggleOn);
	g_option_vars[9].value = g_option_crt_aperture_var;
	std::snprintf(g_option_dither_var, sizeof(g_option_dither_var),
					"Dither; %s|%s|%s|%s", kDitherOff, kDitherPSX, kDitherRGB777Output, kDitherMSX10);
	g_option_vars[10].value = g_option_dither_var;
	std::snprintf(g_option_host_show_usage_gizmo_var, sizeof(g_option_host_show_usage_gizmo_var),
					"Show Usage Gizmo; %s|%s", kToggleOff, kToggleOn);
	g_option_vars[11].value = g_option_host_show_usage_gizmo_var;

	unsigned version = 0;
	if (environ_cb(RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION, &version) && version >= 2) {
		environ_cb(RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2, &g_options_us);
	} else {
		retro_core_options_intl options_intl;
		options_intl.us = g_option_defs_v1_us;
		options_intl.local = nullptr;
		if (!environ_cb(RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL, &options_intl)) {
			environ_cb(RETRO_ENVIRONMENT_SET_CORE_OPTIONS, g_option_defs_v1_us);
		}
	}

	environ_cb(RETRO_ENVIRONMENT_SET_VARIABLES, g_option_vars);
}

static RenderBackendPreference parse_backend_preference(const char* value) {
	if (!value || !value[0]) return RenderBackendPreference::Auto;
	if (std::strcmp(value, kRenderBackendSoftware) == 0 || std::strcmp(value, "Software") == 0) {
		return RenderBackendPreference::Software;
	}
	if (std::strcmp(value, kRenderBackendGLES2) == 0 || std::strcmp(value, "GLES2") == 0) {
		return RenderBackendPreference::GLES2;
	}
	logging.log(RETRO_LOG_WARN,
				"[BMSX] Unknown render backend option '%s', using software\n",
				value);
	return RenderBackendPreference::Software;
}

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

static bool read_postprocess_detail_enabled() {
	return read_toggle_option(kOptionPostprocessDetail, "post-processing detail", false);
}

static bool read_resource_usage_gizmo_enabled() {
	return read_toggle_option(kOptionHostShowUsageGizmo, "Show Usage Gizmo", false);
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

static int read_dither_type() {
	retro_variable var;
	var.key = kOptionDither;
	var.value = kDitherOff;
	if (environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE, &var) && var.value) {
		if (std::strcmp(var.value, kDitherOff) == 0) return 0;
		if (std::strcmp(var.value, kDitherPSX) == 0) return 1;
		if (std::strcmp(var.value, kDitherRGB777Output) == 0) return 2;
		if (std::strcmp(var.value, kDitherMSX10) == 0) return 3;
		if (std::strcmp(var.value, kToggleOn) == 0) return 2;
		if (std::strcmp(var.value, kToggleOff) == 0) return 0;
	}
	return 0;
}

static void apply_backend_preference(RenderBackendPreference preference) {
	if (g_backend_fallback_token.active) {
		g_backend_preference = RenderBackendPreference::Software;
		g_active_backend = bmsx::BackendType::Software;
		return;
	}
	g_backend_preference = preference;
	const bmsx::BackendType desired_backend = resolve_backend_preference(preference);
	if (g_hw_render_requested) {
		if (preference == RenderBackendPreference::Software) {
			logging.log(RETRO_LOG_INFO,
						"[BMSX] Software backend requested, but a hardware backend is already active; restart required\n");
		}
		g_active_backend = g_hw_render_backend;
		return;
	}

	if (is_hardware_backend(desired_backend)) {
		if (!g_hw_render_supported) {
			std::string reason;
			if (!g_hw_render_failure_reason.empty()) {
				reason =
					std::string("[BMSX] ") + backend_label(desired_backend) +
					" backend failed: " + g_hw_render_failure_reason +
					"; using software backend";
			} else {
				reason =
					std::string("[BMSX] ") + backend_label(desired_backend) +
					" backend failed to start; using software backend";
			}
			handle_backend_fallback(desired_backend, reason.c_str());
			return;
		}
		g_active_backend = desired_backend;
		return;
	}

	g_active_backend = desired_backend;
}

static void handle_backend_fallback(bmsx::BackendType backend, const char* reason) {
	logging.log(RETRO_LOG_INFO, "[BMSX] handle_backend_fallback called. Reason: %s\n", reason);
	const bool was_active = g_backend_fallback_token.active;
	GateScope scope;
	scope.blocking = true;
	scope.category = "backend-fallback";
	scope.tag = backend_label(backend);
	g_backend_gate.ensure(g_backend_fallback_token, true, scope);
	if (was_active) {
		return;
	}
	logging.log(RETRO_LOG_WARN, "%s\n", reason);
	if (!g_hw_render_failure_reason.empty()) {
		logging.log(RETRO_LOG_ERROR,
					"[BMSX] %s backend error: %s\n",
					backend_label(backend),
					g_hw_render_failure_reason.c_str());
	}
	static char fallback_message[128];
	std::snprintf(fallback_message, sizeof(fallback_message),
					"BMSX: %s failed, reverted to Software rendering.",
					backend_label(backend));
	retro_message msg;
	msg.msg = fallback_message;
	msg.frames = 240;
	environ_cb(RETRO_ENVIRONMENT_SET_MESSAGE, &msg);
	GateScope option_scope;
	option_scope.category = "option-update";
	option_scope.tag = "render-backend";
	g_backend_gate.ensure(g_backend_option_pending_token, true, option_scope);
	try_update_backend_option();
	g_backend_preference = RenderBackendPreference::Software;
	g_active_backend = bmsx::BackendType::Software;
	g_hw_render_supported = false;
	g_hw_render_requested = false;
	g_hw_render_backend = bmsx::BackendType::Software;
	g_hw_context_pending = false;
	g_hw_context_ready = false;
	if (g_platform) {
		g_platform->switchToSoftwareBackend();
	}
	set_core_options(BMSX_ENABLE_GLES2);
}

static void request_hw_context_for_backend(bmsx::BackendType backend) {
	g_hw_render_supported = false;
	g_hw_render_requested = false;
	g_hw_render_backend = bmsx::BackendType::Software;
	if (g_backend_fallback_token.active) {
		return;
	}
	if (!is_hardware_backend(backend)) {
		return;
	}

	g_hw_render_backend = backend;
	g_hw_render_requested = true;
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
		g_hw_render_failure_reason = "RETRO_ENVIRONMENT_SET_HW_RENDER rejected by frontend";
		logging.log(RETRO_LOG_WARN,
					"[BMSX] Failed to request %s hw render context\n",
					backend_label(backend));
		g_hw_render_supported = false;
		g_hw_render_requested = false;
		g_hw_render_backend = bmsx::BackendType::Software;
		g_hw_context_pending = false;
		g_hw_context_ready = false;
		return;
	}
	g_hw_render_supported = true;
	g_hw_context_pending = true;
	g_hw_context_ready = false;
	g_hw_render_failure_reason.clear();
}

void retro_set_environment(retro_environment_t cb) {
	environ_cb = cb;

	// Try to get logging interface
	if (!cb(RETRO_ENVIRONMENT_GET_LOG_INTERFACE, &logging)) {
	logging.log = fallback_log;
	}

	// We don't need a game to run (for testing empty cart)
	bool no_game = true;
	cb(RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME, &no_game);

	uint64_t serialization_quirks =
		RETRO_SERIALIZATION_QUIRK_MUST_INITIALIZE |
		RETRO_SERIALIZATION_QUIRK_CORE_VARIABLE_SIZE;
	cb(RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS, &serialization_quirks);

	static retro_frame_time_callback frame_time = { libretro_frame_time_callback, 0 };
	cb(RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK, &frame_time);

	// Set input descriptors
	static constexpr unsigned kRetroMouseIdLeft = 2;
	static constexpr unsigned kRetroMouseIdRight = 3;
	static constexpr unsigned kRetroMouseIdMiddle = 6;
	static constexpr unsigned kRetroMouseIdButton4 = 9;
	static constexpr unsigned kRetroMouseIdButton5 = 10;
	static constexpr unsigned kRetroPointerIdX = 0;
	static constexpr unsigned kRetroPointerIdY = 1;
	static const struct retro_input_descriptor input_desc[] = {
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_UP, "Up"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_DOWN, "Down"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_LEFT, "Left"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_RIGHT, "Right"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, "A"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, "B"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_X, "X"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_Y, "Y"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_L, "L"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_R, "R"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_START, "Start"},
		{0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_SELECT, "Select"},
		// Player 2
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_UP, "Up (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_DOWN, "Down (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_LEFT, "Left (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_RIGHT, "Right (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, "A (P2)"},
		{1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, "B (P2)"},
		{0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdLeft, "Pointer Primary"},
		{0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdRight, "Pointer Secondary"},
		{0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdMiddle, "Pointer Aux"},
		{0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdButton4, "Pointer Back"},
		{0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdButton5, "Pointer Forward"},
		{0, RETRO_DEVICE_POINTER, 0, kRetroPointerIdX, "Pointer X"},
		{0, RETRO_DEVICE_POINTER, 0, kRetroPointerIdY, "Pointer Y"},
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
	if (g_platform) {
	g_platform->setInputPollCallback(cb);
	}
}

void retro_set_input_state(retro_input_state_t cb) {
	input_state_cb = cb;
	if (g_platform) {
	g_platform->setInputStateCallback(cb);
	}
}

/* ============================================================================
 * Core lifecycle
 * ============================================================================
 */

void retro_init(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] retro_init\n");
	const RenderBackendPreference preference = read_backend_preference();
	const bmsx::BackendType desired_backend = resolve_backend_preference(preference);
	g_crt_postprocessing_enabled = read_crt_postprocessing_enabled();
	g_postprocess_detail_enabled = read_postprocess_detail_enabled();
	g_crt_noise_enabled = read_crt_noise_enabled();
	g_crt_color_bleed_enabled = read_crt_color_bleed_enabled();
	g_crt_scanlines_enabled = read_crt_scanlines_enabled();
	g_crt_blur_enabled = read_crt_blur_enabled();
	g_crt_glow_enabled = read_crt_glow_enabled();
	g_crt_fringing_enabled = read_crt_fringing_enabled();
	g_crt_aperture_enabled = read_crt_aperture_enabled();
	g_dither_type = read_dither_type();
	g_resource_usage_gizmo_enabled = read_resource_usage_gizmo_enabled();
	request_hw_context_for_backend(desired_backend);
	apply_backend_preference(preference);
	set_core_options(BMSX_ENABLE_GLES2);

	const char* system_dir = nullptr;
	if (environ_cb(RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY, &system_dir) && system_dir && system_dir[0]) {
	g_system_dir = sanitizeSystemDir(system_dir);
	if (!g_system_dir.empty()) {
		logging.log(RETRO_LOG_INFO, "[BMSX] System directory: %s\n", g_system_dir.c_str());
	} else {
		logging.log(RETRO_LOG_INFO, "[BMSX] System directory not provided\n");
	}
	} else {
	g_system_dir.clear();
	logging.log(RETRO_LOG_INFO, "[BMSX] System directory not provided\n");
	}
	if (!isHardwareBackendActive()) {
	const bmsx::BackendType desired_backend = resolve_backend_preference(g_backend_preference);
	if (is_hardware_backend(desired_backend)) {
		logging.log(RETRO_LOG_WARN,
					"[BMSX] %s hardware backend not initialized; using software backend\n",
					backend_label(desired_backend));
	} else {
		logging.log(RETRO_LOG_INFO,
					"[BMSX] Software backend selected via core option\n");
	}
	g_hw_context_pending = false;
	g_hw_context_ready = false;
	}

	// Set pixel format
	enum retro_pixel_format fmt = RETRO_PIXEL_FORMAT_XRGB8888;
	if (!environ_cb(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &fmt)) {
	logging.log(RETRO_LOG_WARN,
				"[BMSX] XRGB8888 not supported, trying RGB565\n");
	fmt = RETRO_PIXEL_FORMAT_RGB565;
	environ_cb(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &fmt);
	}

	// Create platform instance
	g_platform = new bmsx::LibretroPlatform(g_active_backend);
	g_platform->setEnvironmentCallback(environ_cb);
	g_platform->setLogCallback(logging.log);
	g_platform->setSystemDirectory(g_system_dir);
	g_platform->setVideoCallback(video_cb);
	g_platform->setAudioBatchCallback(audio_batch_cb);
	g_platform->setInputPollCallback(input_poll_cb);
	g_platform->setInputStateCallback(input_state_cb);
	g_platform->setPostProcessOptions(g_crt_postprocessing_enabled, g_postprocess_detail_enabled);
	g_platform->setCrtEffectOptions(g_crt_noise_enabled,
									g_crt_color_bleed_enabled,
									g_crt_scanlines_enabled,
									g_crt_blur_enabled,
									g_crt_glow_enabled,
									g_crt_fringing_enabled,
									g_crt_aperture_enabled);
	g_platform->setDitherType(g_dither_type);
	g_platform->setResourceUsageGizmo(g_resource_usage_gizmo_enabled);
	if (isHardwareBackendActive()) {
	try {
		g_platform->setHwRenderCallbacks(g_hw_render.get_current_framebuffer);
	} catch (const std::exception& err) {
		logging.log(RETRO_LOG_ERROR,
					"[BMSX] %s setup exception: %s\n",
					backend_label(g_active_backend),
					err.what());
		g_hw_render_failure_reason = err.what();
		const std::string reason =
			std::string("[BMSX] ") + backend_label(g_active_backend) +
			" setup failed: " + err.what();
		handle_backend_fallback(g_active_backend, reason.c_str());
	}
	}
	if (g_cached_av_info_valid) {
	g_platform->setAVInfo(g_cached_av_info);
	}
	if (g_has_pending_frame_time) {
	g_platform->setFrameTimeUsec(g_pending_frame_time_usec);
	g_has_pending_frame_time = false;
	}
	
	// Defer actual context reset to retro_run. Some frontends/devices (notably
	// older embedded hosts) are not stable when heavy GL init work is done
	// directly in the context_reset callback/init path.
}

void retro_deinit(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] retro_deinit\n");

	delete g_platform;
	g_platform = nullptr;
}

unsigned retro_api_version(void) { return RETRO_API_VERSION; }

void retro_get_system_info(struct retro_system_info* info) {
	std::memset(info, 0, sizeof(*info));
	info->library_name = CORE_NAME;
	info->library_version = CORE_VERSION;
	info->valid_extensions = VALID_EXTENSIONS;
	info->need_fullpath = true;  // Load ROM from path to avoid duplicate in-memory copy
	info->block_extract = false;  // We can handle zipped files ourselves
}

void retro_get_system_av_info(struct retro_system_av_info* info) {
	if (!g_cached_av_info_valid) {
		initialize_default_av_info(g_cached_av_info);
		g_cached_av_info_valid = true;
	}
	*info = g_cached_av_info;

	logging.log(
		RETRO_LOG_INFO,
		"[BMSX] System AV Info requested: %ux%u @ %.2fHz, Sample Rate: %.2fHz\n",
		info->geometry.base_width, info->geometry.base_height, info->timing.fps,
		info->timing.sample_rate);
}

extern "C" void bmsx_set_frame_time_usec(retro_usec_t usec) {
	if (usec == 0) {
		return;
	}
	g_pending_frame_time_usec = usec;
	g_has_pending_frame_time = true;
	g_platform->setFrameTimeUsec(usec);
}

extern "C" int64_t bmsx_get_ufps(void) {
	// disable-next-line or_nil_fallback_pattern -- libretro may ask timing before game load; nullptr means use default timing.
	auto* console = g_platform ? g_platform->console() : nullptr;
	return console ? console->machineManifest().ufpsScaled.value() : bmsx::DEFAULT_UFPS_SCALED;
}

void retro_set_controller_port_device(unsigned port, unsigned device) {
	logging.log(RETRO_LOG_INFO, "[BMSX] Port %u set to device %u\n", port,
				device);
	g_platform->setControllerDevice(port, device);
}

/* ============================================================================
 * Game lifecycle
 * ============================================================================
 */

bool retro_load_game(const struct retro_game_info* game) {
	if (!game) {
		logging.log(RETRO_LOG_INFO,
					"[BMSX] No game provided, loading empty cart\n");
		return g_platform->loadEmptyCart();
	}

	logging.log(RETRO_LOG_INFO, "[BMSX] Loading game: %s\n",
				game->path ? game->path : "(memory)");

	bool loaded_ok = false;
	if (game->data && game->size > 0) {
		if (game->path) {
			g_platform->tryLoadSystemRom(game->path);
		}
		loaded_ok = g_platform->loadRom(static_cast<const uint8_t*>(game->data),
										game->size);
	} else if (game->path) {
		loaded_ok = g_platform->loadRomFromPath(game->path);
	} else {
		logging.log(RETRO_LOG_ERROR, "[BMSX] No game data or path provided\n");
		return false;
	}
	if (!loaded_ok) {
		return false;
	}

	const int64_t ufps_scaled = bmsx_get_ufps();
	struct retro_system_av_info av = g_cached_av_info;
	if (!g_cached_av_info_valid) {
		memset(&av, 0, sizeof(av));
		retro_get_system_av_info(&av);
	}
	const auto& manifest = g_platform->console()->machineManifest();
	apply_manifest_av_info(av, manifest, ufps_scaled);
	g_cached_av_info = av;
	g_cached_av_info_valid = true;
	g_platform->setAVInfo(av);

	return true;
}

bool retro_load_game_special(unsigned game_type,
								const struct retro_game_info* info,
								size_t num_info) {
	// We don't support special game loading
	(void)game_type;
	(void)info;
	(void)num_info;
	return false;
}

void retro_unload_game(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] Unloading game\n");
	g_platform->unloadRom();
}

/* ============================================================================
 * Emulation
 * ============================================================================
 */

void retro_reset(void) {
	logging.log(RETRO_LOG_INFO, "[BMSX] Reset\n");
	g_platform->reset();
}

void retro_run(void) {
	try_update_backend_option();
	if (isHardwareBackendActive() && g_hw_context_pending && g_platform) {
	try {
		g_platform->onContextReset();
		g_hw_context_ready = true;
		g_hw_context_pending = false;
		g_hw_render_failure_reason.clear();
	} catch (const std::exception& err) {
		logging.log(RETRO_LOG_ERROR,
					"[BMSX] %s context reset exception: %s\n",
					backend_label(g_active_backend),
					err.what());
		g_hw_render_failure_reason = err.what();
		const std::string reason =
			std::string("[BMSX] ") + backend_label(g_active_backend) +
			" context reset failed: " + err.what();
		handle_backend_fallback(g_active_backend, reason.c_str());
	}
	}
	if (isHardwareBackendActive() && !g_hw_context_ready) {
	logging.log(RETRO_LOG_WARN, "[BMSX] retro_run: HW backend active but context not ready. g_hw_context_pending=%d\n", g_hw_context_pending);
	const std::string reason =
		std::string("[BMSX] ") + backend_label(g_active_backend) +
		" hw render context not initialized; falling back to software";
	handle_backend_fallback(g_active_backend, reason.c_str());
	}
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
	const bool new_crt = read_crt_postprocessing_enabled();
	const bool new_detail = read_postprocess_detail_enabled();
	if (new_crt != g_crt_postprocessing_enabled || new_detail != g_postprocess_detail_enabled) {
		g_crt_postprocessing_enabled = new_crt;
		g_postprocess_detail_enabled = new_detail;
		g_platform->setPostProcessOptions(g_crt_postprocessing_enabled, g_postprocess_detail_enabled);
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
		g_platform->setCrtEffectOptions(g_crt_noise_enabled,
										g_crt_color_bleed_enabled,
										g_crt_scanlines_enabled,
										g_crt_blur_enabled,
										g_crt_glow_enabled,
										g_crt_fringing_enabled,
										g_crt_aperture_enabled);
	}
	const int new_dither = read_dither_type();
	if (new_dither != g_dither_type) {
		g_dither_type = new_dither;
		g_platform->setDitherType(g_dither_type);
	}
	const bool new_resource_usage_gizmo = read_resource_usage_gizmo_enabled();
	if (new_resource_usage_gizmo != g_resource_usage_gizmo_enabled) {
		g_resource_usage_gizmo_enabled = new_resource_usage_gizmo;
		g_platform->setResourceUsageGizmo(g_resource_usage_gizmo_enabled);
	}
	}
//   static auto lastFrameTime = std::chrono::steady_clock::now();
//   static double accSec = 0.0;
//   static double accMs = 0.0;
//   static double minMs = std::numeric_limits<double>::infinity();
//   static double maxMs = 0.0;
//   static uint64_t accCalls = 0;
#if BMSX_ENABLE_PERFORMANCE_LOGS
	static auto perfStart = std::chrono::steady_clock::now();
	static double accRunMs = 0.0;
	static double accTickMs = 0.0;
	static double accRenderMs = 0.0;
	static double accOverheadMs = 0.0;
	static double accRuntimeUpdateMs = 0.0;
	static double accRuntimeDrawMs = 0.0;
	static double maxRunMs = 0.0;
	static double maxTickMs = 0.0;
	static double maxRenderMs = 0.0;
	static double maxOverheadMs = 0.0;
	static double maxRuntimeUpdateMs = 0.0;
	static double maxRuntimeDrawMs = 0.0;
	static uint64_t perfFrames = 0;
#endif

	// const auto now = std::chrono::steady_clock::now();
	// const double dtSec = std::chrono::duration<double>(now - lastFrameTime).count();
	// const double dtMs = dtSec * 1000.0;
	// lastFrameTime = now;

	// accSec += dtSec;
	// accMs += dtMs;
	// accCalls += 1;
	// if (dtMs < minMs) minMs = dtMs;
	// if (dtMs > maxMs) maxMs = dtMs;
	// if (accSec >= 1.0) {
	// const double avgMs = accMs / static_cast<double>(accCalls);
	// const double fps = static_cast<double>(accCalls) / accSec;
	// const double targetMs = g_platform->frameTimeSec() * 1000.0;
	// const double targetFps = 1.0 / g_platform->frameTimeSec();
	// logging.log(RETRO_LOG_WARN,
	// 			"[BMSX] host frame timing avg=%.2fms min=%.2f max=%.2f fps=%.1f target=%.2fms (%.1f fps) calls=%llu\n",
	// 			avgMs,
	// 			minMs,
	// 			maxMs,
	// 			fps,
	// 			targetMs,
	// 			targetFps,
	// 			static_cast<unsigned long long>(accCalls));
	// accSec = 0.0;
	// accMs = 0.0;
	// minMs = std::numeric_limits<double>::infinity();
	// maxMs = 0.0;
	// accCalls = 0;
	// }

	// Run one frame
//   const auto runStart = std::chrono::steady_clock::now();
	g_platform->runFrame();
//   const auto runEnd = std::chrono::steady_clock::now();
//   const double runMs = std::chrono::duration<double, std::milli>(runEnd - runStart).count();
//   const auto& tickTiming = g_platform->console()->lastTickTiming();
//   const auto& renderTiming = g_platform->console()->lastRenderTiming();
//   const double overheadMs = runMs - tickTiming.totalMs - renderTiming.totalMs;

//   accRunMs += runMs;
//   accTickMs += tickTiming.totalMs;
//   accRenderMs += renderTiming.totalMs;
//   accOverheadMs += overheadMs;
//   accRuntimeUpdateMs += tickTiming.runtimeUpdateMs;
//   accRuntimeDrawMs += renderTiming.runtimeDrawMs;
//   if (runMs > maxRunMs) maxRunMs = runMs;
//   if (tickTiming.totalMs > maxTickMs) maxTickMs = tickTiming.totalMs;
//   if (renderTiming.totalMs > maxRenderMs) maxRenderMs = renderTiming.totalMs;
//   if (overheadMs > maxOverheadMs) maxOverheadMs = overheadMs;
//   if (tickTiming.runtimeUpdateMs > maxRuntimeUpdateMs) maxRuntimeUpdateMs = tickTiming.runtimeUpdateMs;
//   if (renderTiming.runtimeDrawMs > maxRuntimeDrawMs) maxRuntimeDrawMs = renderTiming.runtimeDrawMs;
//   perfFrames += 1;

//   const double perfSec = std::chrono::duration<double>(runEnd - perfStart).count();
//   if (perfSec >= 1.0) {
// 	const double invFrames = 1.0 / static_cast<double>(perfFrames);
// 	logging.log(RETRO_LOG_WARN,
// 				"[BMSX] run avg=%.2fms max=%.2f tick=%.2f render=%.2f overhead=%.2f frames=%llu\n",
// 				accRunMs * invFrames,
// 				maxRunMs,
// 				accTickMs * invFrames,
// 				accRenderMs * invFrames,
// 				accOverheadMs * invFrames,
// 				static_cast<unsigned long long>(perfFrames));
// 	logging.log(RETRO_LOG_WARN,
// 				"[BMSX] runtime avg update=%.2f draw=%.2f max_update=%.2f max_draw=%.2f\n",
// 				accRuntimeUpdateMs * invFrames,
// 				accRuntimeDrawMs * invFrames,
// 				maxRuntimeUpdateMs,
// 				maxRuntimeDrawMs);
// 	perfStart = runEnd;
// 	accRunMs = 0.0;
// 	accTickMs = 0.0;
// 	accRenderMs = 0.0;
// 	accOverheadMs = 0.0;
// 	accRuntimeUpdateMs = 0.0;
// 	accRuntimeDrawMs = 0.0;
// 	maxRunMs = 0.0;
// 	maxTickMs = 0.0;
// 	maxRenderMs = 0.0;
// 	maxOverheadMs = 0.0;
// 	maxRuntimeUpdateMs = 0.0;
// 	maxRuntimeDrawMs = 0.0;
// 	perfFrames = 0;
//   }

	// Output video
	const auto& fb = g_platform->getFramebuffer();
	if (isHardwareBackendActive()) {
	video_cb(RETRO_HW_FRAME_BUFFER_VALID, fb.width, fb.height, 0);
	} else {
	video_cb(fb.data, fb.width, fb.height, fb.pitch);
	}

	// Output audio
	const auto& audio = g_platform->getAudioBuffer();
	if (audio_batch_cb && audio.samples > 0) {
	audio_batch_cb(audio.data, audio.samples);
	}
}

/* ============================================================================
 * Serialization (save states)
 * ============================================================================
 */

size_t retro_serialize_size(void) { return g_platform->getStateSize(); }

bool retro_serialize(void* data, size_t size) {
	return g_platform->saveState(data, size);
}
bool retro_unserialize(const void* data, size_t size) {
	return g_platform->loadState(data, size);
}

/* ============================================================================
 * Cheats
 * ============================================================================
 */

// disable-next-line single_line_method_pattern -- libretro cheat reset is a public C ABI callback delegating to platform-owned cheat state.
void retro_cheat_reset(void) { g_platform->resetCheats(); }

// disable-next-line single_line_method_pattern -- libretro cheat set is a public C ABI callback delegating to platform-owned cheat state.
void retro_cheat_set(unsigned index, bool enabled, const char* code) {
	g_platform->setCheat(index, enabled, code);
}

/* ============================================================================
 * Memory access
 * ============================================================================
 */

unsigned retro_get_region(void) {
	// TODO: Detect region from ROM
	return RETRO_REGION_PAL;
}

void* retro_get_memory_data(unsigned id) {
	switch (id) {
	case RETRO_MEMORY_SAVE_RAM:
		return g_platform->getSaveRAM();
	case RETRO_MEMORY_SYSTEM_RAM:
		return g_platform->getSystemRAM();
	default:
		return nullptr;
	}
}

size_t retro_get_memory_size(unsigned id) {
	switch (id) {
	case RETRO_MEMORY_SAVE_RAM:
		return g_platform->getSaveRAMSize();
	case RETRO_MEMORY_SYSTEM_RAM:
		return g_platform->getSystemRAMSize();
	default:
		return 0;
	}
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
	logging.log(RETRO_LOG_INFO, "[BMSX] hw_context_reset called. g_platform=%p\n", g_platform);
	if (!g_hw_render_requested) {
	logging.log(RETRO_LOG_INFO, "[BMSX] hw_context_reset ignored (not requested)\n");
	return;
	}
	g_hw_context_pending = true;
	g_hw_context_ready = false;
}

static void hw_context_destroy() {
	logging.log(RETRO_LOG_INFO, "[BMSX] hw_context_destroy called\n");
	if (!g_hw_render_requested) {
	return;
	}
	if (g_platform) {
	g_platform->onContextDestroy();
	}
	g_hw_context_ready = false;
	g_hw_context_pending = false;
}
