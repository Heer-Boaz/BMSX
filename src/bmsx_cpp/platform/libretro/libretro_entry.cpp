/*
 * libretro_entry.cpp - Libretro core entry points
 *
 * This file implements all the required libretro callbacks that RetroArch
 * uses to communicate with the BMSX engine core.
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

#include "libretro.h"
#include "libretro_platform.h"

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
static retro_hw_render_callback g_hw_render;
static bool g_hw_render_supported = false;
static bool g_hw_render_requested = false;
static bool g_hw_context_pending = false;
static bool g_hw_context_ready = false;
static bmsx::BackendType g_active_backend = bmsx::BackendType::Software;
static bmsx::BackendType g_hw_render_backend = bmsx::BackendType::Software;
static std::string g_system_dir;

// The platform instance
static bmsx::LibretroPlatform* g_platform = nullptr;
static retro_system_av_info g_cached_av_info{};
static bool g_cached_av_info_valid = false;

static constexpr const char* kOptionRenderBackend = "bmsx_render_backend";
static constexpr const char* kRenderBackendSoftware = "software";
static constexpr const char* kRenderBackendGLES2 = "gles2";

enum class RenderBackendPreference {
	Auto,
	Software,
	GLES2
};

static RenderBackendPreference g_backend_preference = RenderBackendPreference::Auto;
static bool g_backend_fallback_notified = false;

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
	{nullptr, nullptr, nullptr, {{nullptr, nullptr}}, nullptr}
};

static char g_option_render_backend_var[128] = {};
static retro_variable g_option_vars[] = {
	{kOptionRenderBackend, nullptr},
	{nullptr, nullptr}
};

// Forward declarations
static void fallback_log(enum retro_log_level level, const char* fmt, ...);
// static void frame_time_cb(retro_usec_t usec);
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

/* ============================================================================
 * Libretro callback setters
 * ============================================================================
 */

static bmsx::BackendType resolve_backend_preference(RenderBackendPreference preference) {
	if (preference == RenderBackendPreference::Software) {
		return bmsx::BackendType::Software;
	}
	if (preference == RenderBackendPreference::GLES2) {
		return bmsx::BackendType::OpenGLES2;
	}
	return bmsx::BackendType::OpenGLES2;
}

static bool is_hardware_backend(bmsx::BackendType type) {
	switch (type) {
		case bmsx::BackendType::Software:
			return false;
		case bmsx::BackendType::OpenGLES2:
			return true;
		default:
			throw std::runtime_error("[BMSX] Unsupported libretro backend.");
	}
}

static const char* backend_label(bmsx::BackendType type) {
	switch (type) {
		case bmsx::BackendType::Software:
			return "Software";
		case bmsx::BackendType::OpenGLES2:
			return "GLES2";
		default:
			throw std::runtime_error("[BMSX] Unsupported libretro backend.");
	}
}

static bool isHardwareBackendActive() {
	return is_hardware_backend(g_active_backend);
}

static void set_core_options(bool default_gles2) {
	const char* default_backend = default_gles2 ? kRenderBackendGLES2 : kRenderBackendSoftware;
	g_option_defs_us[0].default_value = default_backend;
	g_option_defs_v1_us[0].default_value = default_backend;

	g_option_defs_us[0].values[0] = {kRenderBackendGLES2, "GLES2"};
	g_option_defs_us[0].values[1] = {kRenderBackendSoftware, "Software"};
	g_option_defs_us[0].values[2] = {nullptr, nullptr};
	g_option_defs_v1_us[0].values[0] = {kRenderBackendGLES2, "GLES2"};
	g_option_defs_v1_us[0].values[1] = {kRenderBackendSoftware, "Software"};
	g_option_defs_v1_us[0].values[2] = {nullptr, nullptr};

	if (default_gles2) {
		std::snprintf(g_option_render_backend_var, sizeof(g_option_render_backend_var),
					  "Render Backend; %s|%s", kRenderBackendGLES2, kRenderBackendSoftware);
	} else {
		std::snprintf(g_option_render_backend_var, sizeof(g_option_render_backend_var),
					  "Render Backend; %s|%s", kRenderBackendSoftware, kRenderBackendGLES2);
	}
	g_option_vars[0].value = g_option_render_backend_var;

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

static RenderBackendPreference read_backend_preference() {
	retro_variable var;
	var.key = kOptionRenderBackend;
	var.value = nullptr;
	if (environ_cb(RETRO_ENVIRONMENT_GET_VARIABLE, &var) && var.value) {
		return parse_backend_preference(var.value);
	}
	return RenderBackendPreference::Auto;
}

static void apply_backend_preference(RenderBackendPreference preference) {
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
			const std::string reason =
				std::string("[BMSX] ") + backend_label(desired_backend) +
				" backend requested but not supported; using software backend";
			handle_backend_fallback(desired_backend, reason.c_str());
			return;
		}
		g_active_backend = desired_backend;
		return;
	}

	g_active_backend = desired_backend;
}

static void handle_backend_fallback(bmsx::BackendType backend, const char* reason) {
	logging.log(RETRO_LOG_WARN, "%s\n", reason);
	if (!g_backend_fallback_notified) {
		static char fallback_message[128];
		std::snprintf(fallback_message, sizeof(fallback_message),
					  "BMSX: %s failed, reverted to Software rendering.",
					  backend_label(backend));
		retro_message msg;
		msg.msg = fallback_message;
		msg.frames = 240;
		environ_cb(RETRO_ENVIRONMENT_SET_MESSAGE, &msg);
		g_backend_fallback_notified = true;
	}
	retro_variable var;
	var.key = kOptionRenderBackend;
	var.value = kRenderBackendSoftware;
	if (!environ_cb(RETRO_ENVIRONMENT_SET_VARIABLE, &var)) {
		logging.log(RETRO_LOG_WARN,
					"[BMSX] Failed to update core option '%s' to software\n",
					kOptionRenderBackend);
	}
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
}

static void request_hw_context_for_backend(bmsx::BackendType backend) {
	g_hw_render_supported = false;
	g_hw_render_requested = false;
	g_hw_render_backend = bmsx::BackendType::Software;
	if (!is_hardware_backend(backend)) {
		return;
	}

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

	if (!environ_cb(RETRO_ENVIRONMENT_SET_HW_RENDER, &g_hw_render)) {
		g_hw_render_supported = false;
		g_hw_render_requested = false;
		return;
	}
	g_hw_render_supported = true;
	g_hw_render_requested = true;
	g_hw_render_backend = backend;
}

void retro_set_environment(retro_environment_t cb) {
  environ_cb = cb;
  g_backend_fallback_notified = false;
  g_hw_context_pending = false;
  g_hw_context_ready = false;

  // Try to get logging interface
  if (cb(RETRO_ENVIRONMENT_GET_LOG_INTERFACE, &logging)) {
	// Got log callback
  } else {
	logging.log = fallback_log;
  }

  // We don't need a game to run (for testing empty cart)
  bool no_game = true;
  cb(RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME, &no_game);

  // Set input descriptors
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
	  {0, 0, 0, 0, nullptr}};
  cb(RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS, (void*)input_desc);

  // retro_frame_time_callback frame_time{};
  // frame_time.callback = frame_time_cb;
  // frame_time.reference = 0;
  // cb(RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK, &frame_time);

  set_core_options(true);

  const RenderBackendPreference preference = read_backend_preference();
  const bmsx::BackendType desired_backend = resolve_backend_preference(preference);

  request_hw_context_for_backend(desired_backend);

  apply_backend_preference(preference);

  const char* system_dir = nullptr;
  if (cb(RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY, &system_dir) && system_dir && system_dir[0]) {
	g_system_dir = system_dir;
	logging.log(RETRO_LOG_INFO, "[BMSX] System directory: %s\n", g_system_dir.c_str());
  } else {
	g_system_dir.clear();
	logging.log(RETRO_LOG_INFO, "[BMSX] System directory not provided\n");
  }
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
  apply_backend_preference(read_backend_preference());
  g_hw_context_ready = false;
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
  if (isHardwareBackendActive()) {
	try {
	  g_platform->setHwRenderCallbacks(g_hw_render.get_current_framebuffer);
	} catch (const std::exception& err) {
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
  if (isHardwareBackendActive() && g_hw_context_pending) {
	try {
	  g_platform->onContextReset();
	  g_hw_context_ready = true;
	} catch (const std::exception& err) {
	  const std::string reason =
		  std::string("[BMSX] ") + backend_label(g_active_backend) +
		  " context reset failed: " + err.what();
	  handle_backend_fallback(g_active_backend, reason.c_str());
	}
	g_hw_context_pending = false;
  }
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
  info->need_fullpath = false;  // We can load from memory
  info->block_extract = false;  // We can handle zipped files ourselves
}

void retro_get_system_av_info(struct retro_system_av_info* info) {
  // Default resolution - this should match your game's base resolution
  constexpr unsigned BASE_WIDTH = 100;
  constexpr unsigned BASE_HEIGHT = 100;
  constexpr unsigned MAX_WIDTH = 512;
  constexpr unsigned MAX_HEIGHT = 448;
  constexpr double FPS = 50.0;
  constexpr double SAMPLE_RATE = 48000.0;
	
  info->geometry.base_width = BASE_WIDTH;
  info->geometry.base_height = BASE_HEIGHT;
  info->geometry.max_width = MAX_WIDTH;
  info->geometry.max_height = MAX_HEIGHT;
  info->geometry.aspect_ratio =
	  static_cast<float>(BASE_WIDTH) / static_cast<float>(BASE_HEIGHT);

  info->timing.fps = FPS;
  info->timing.sample_rate = SAMPLE_RATE;

  logging.log(
	  RETRO_LOG_INFO,
	  "[BMSX] System AV Info requested: %ux%u @ %.2fHz, Sample Rate: %.2fHz\n",
	  info->geometry.base_width, info->geometry.base_height, info->timing.fps,
	  info->timing.sample_rate);
  g_cached_av_info = *info;
  g_cached_av_info_valid = true;
  g_platform->setAVInfo(*info);
  g_platform->applyManifestViewport();
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

  // Try to load engine assets from the same directory as the ROM
  if (game->path) {
	g_platform->tryLoadEngineAssets(game->path);
  }

  if (game->data && game->size > 0) {
	return g_platform->loadRom(static_cast<const uint8_t*>(game->data),
							   game->size);
  } else if (game->path) {
	return g_platform->loadRomFromPath(game->path);
  }

  logging.log(RETRO_LOG_ERROR, "[BMSX] No game data or path provided\n");
  return false;
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
  if (isHardwareBackendActive() && !g_hw_context_ready) {
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
  }
  static auto lastFrameTime = std::chrono::steady_clock::now();
  static double accSec = 0.0;
  static double accMs = 0.0;
  static double minMs = std::numeric_limits<double>::infinity();
  static double maxMs = 0.0;
  static uint64_t accCalls = 0;
  static auto perfStart = std::chrono::steady_clock::now();
  static double accRunMs = 0.0;
  static double accTickMs = 0.0;
  static double accRenderMs = 0.0;
  static double accOverheadMs = 0.0;
  static double accVmUpdateMs = 0.0;
  static double accVmDrawMs = 0.0;
  static double accDrawGameMs = 0.0;
  static double maxRunMs = 0.0;
  static double maxTickMs = 0.0;
  static double maxRenderMs = 0.0;
  static double maxOverheadMs = 0.0;
  static double maxVmUpdateMs = 0.0;
  static double maxVmDrawMs = 0.0;
  static double maxDrawGameMs = 0.0;
  static uint64_t perfFrames = 0;

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
  const auto runStart = std::chrono::steady_clock::now();
  g_platform->runFrame();
  const auto runEnd = std::chrono::steady_clock::now();
  const double runMs = std::chrono::duration<double, std::milli>(runEnd - runStart).count();
  const auto& tickTiming = g_platform->engine()->lastTickTiming();
  const auto& renderTiming = g_platform->engine()->lastRenderTiming();
  const double overheadMs = runMs - tickTiming.totalMs - renderTiming.totalMs;

  accRunMs += runMs;
  accTickMs += tickTiming.totalMs;
  accRenderMs += renderTiming.totalMs;
  accOverheadMs += overheadMs;
  accVmUpdateMs += tickTiming.vmUpdateMs;
  accVmDrawMs += renderTiming.vmDrawMs;
  accDrawGameMs += renderTiming.drawGameMs;
  if (runMs > maxRunMs) maxRunMs = runMs;
  if (tickTiming.totalMs > maxTickMs) maxTickMs = tickTiming.totalMs;
  if (renderTiming.totalMs > maxRenderMs) maxRenderMs = renderTiming.totalMs;
  if (overheadMs > maxOverheadMs) maxOverheadMs = overheadMs;
  if (tickTiming.vmUpdateMs > maxVmUpdateMs) maxVmUpdateMs = tickTiming.vmUpdateMs;
  if (renderTiming.vmDrawMs > maxVmDrawMs) maxVmDrawMs = renderTiming.vmDrawMs;
  if (renderTiming.drawGameMs > maxDrawGameMs) maxDrawGameMs = renderTiming.drawGameMs;
  perfFrames += 1;

  const double perfSec = std::chrono::duration<double>(runEnd - perfStart).count();
  if (perfSec >= 1.0) {
	const double invFrames = 1.0 / static_cast<double>(perfFrames);
	logging.log(RETRO_LOG_WARN,
				"[BMSX] run avg=%.2fms max=%.2f tick=%.2f render=%.2f overhead=%.2f frames=%llu\n",
				accRunMs * invFrames,
				maxRunMs,
				accTickMs * invFrames,
				accRenderMs * invFrames,
				accOverheadMs * invFrames,
				static_cast<unsigned long long>(perfFrames));
	logging.log(RETRO_LOG_WARN,
				"[BMSX] vm avg update=%.2f draw=%.2f draw_game=%.2f max_update=%.2f max_draw=%.2f max_draw_game=%.2f\n",
				accVmUpdateMs * invFrames,
				accVmDrawMs * invFrames,
				accDrawGameMs * invFrames,
				maxVmUpdateMs,
				maxVmDrawMs,
				maxDrawGameMs);
	perfStart = runEnd;
	accRunMs = 0.0;
	accTickMs = 0.0;
	accRenderMs = 0.0;
	accOverheadMs = 0.0;
	accVmUpdateMs = 0.0;
	accVmDrawMs = 0.0;
	accDrawGameMs = 0.0;
	maxRunMs = 0.0;
	maxTickMs = 0.0;
	maxRenderMs = 0.0;
	maxOverheadMs = 0.0;
	maxVmUpdateMs = 0.0;
	maxVmDrawMs = 0.0;
	maxDrawGameMs = 0.0;
	perfFrames = 0;
  }

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

void retro_cheat_reset(void) { g_platform->resetCheats(); }

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

// static void frame_time_cb(retro_usec_t usec) {
//   logging.log(RETRO_LOG_WARN, "[BMSX] frame_time_cb: %llu usec (%.3fms, %.2f fps)\n",
// 			  static_cast<unsigned long long>(usec),
// 			  static_cast<double>(usec) / 1000.0,
// 			  1000000.0 / static_cast<double>(usec));
//   if (g_platform) {
// 	g_platform->setFrameTimeUsec(usec);
// 	return;
//   }
//   g_pending_frame_time_usec = usec;
//   g_has_pending_frame_time = true;
// }

static void hw_context_reset() {
  if (!isHardwareBackendActive()) {
	return;
  }
  if (g_platform) {
	try {
	  g_platform->onContextReset();
	  g_hw_context_ready = true;
	  return;
	} catch (const std::exception& err) {
	  const std::string reason =
		  std::string("[BMSX] ") + backend_label(g_active_backend) +
		  " context reset failed: " + err.what();
	  handle_backend_fallback(g_active_backend, reason.c_str());
	  return;
	}
  }
  g_hw_context_pending = true;
}

static void hw_context_destroy() {
  if (!isHardwareBackendActive()) {
	return;
  }
  if (g_platform) {
	g_platform->onContextDestroy();
  }
  g_hw_context_ready = false;
}
