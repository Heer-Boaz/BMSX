/*
 * libretro_entry.cpp - Libretro core entry points
 *
 * This file implements all the required libretro callbacks that RetroArch
 * uses to communicate with the BMSX engine core.
 */

#include <cstdarg>
#include <cstdio>
#include <cstring>

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

// The platform instance
static bmsx::LibretroPlatform* g_platform = nullptr;
static retro_system_av_info g_cached_av_info{};
static bool g_cached_av_info_valid = false;

// Forward declarations
static void fallback_log(enum retro_log_level level, const char* fmt, ...);

/* ============================================================================
 * Libretro callback setters
 * ============================================================================
 */

void retro_set_environment(retro_environment_t cb) {
  environ_cb = cb;

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
}

void retro_set_video_refresh(retro_video_refresh_t cb) {
  video_cb = cb;
  g_platform->setVideoCallback(cb);
}

void retro_set_audio_sample(retro_audio_sample_t cb) { audio_cb = cb; }

void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {
  audio_batch_cb = cb;
  g_platform->setAudioBatchCallback(cb);
}

void retro_set_input_poll(retro_input_poll_t cb) {
  input_poll_cb = cb;
  g_platform->setInputPollCallback(cb);
}

void retro_set_input_state(retro_input_state_t cb) {
  input_state_cb = cb;
  g_platform->setInputStateCallback(cb);
}

/* ============================================================================
 * Core lifecycle
 * ============================================================================
 */

void retro_init(void) {
  logging.log(RETRO_LOG_INFO, "[BMSX] retro_init\n");

  // Set pixel format
  enum retro_pixel_format fmt = RETRO_PIXEL_FORMAT_XRGB8888;
  if (!environ_cb(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &fmt)) {
    logging.log(RETRO_LOG_WARN,
                "[BMSX] XRGB8888 not supported, trying RGB565\n");
    fmt = RETRO_PIXEL_FORMAT_RGB565;
    environ_cb(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &fmt);
  }

  // Create platform instance
  g_platform = new bmsx::LibretroPlatform();
  g_platform->setEnvironmentCallback(environ_cb);
  g_platform->setLogCallback(logging.log);
  g_platform->setVideoCallback(video_cb);
  g_platform->setAudioBatchCallback(audio_batch_cb);
  g_platform->setInputPollCallback(input_poll_cb);
  g_platform->setInputStateCallback(input_state_cb);
  if (g_cached_av_info_valid) {
    g_platform->setAVInfo(g_cached_av_info);
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
  // Run one frame
  g_platform->runFrame();

  // Output video
  const auto& fb = g_platform->getFramebuffer();
  if (video_cb && fb.data) {
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
