#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "libretro.h"
#include "video_context.h"

typedef enum BmsxInputDriverKind {
	BMSX_INPUT_DRIVER_EVDEV,
	BMSX_INPUT_DRIVER_SDL,
} BmsxInputDriverKind;

void input_devices_open(
		BmsxInputDriverKind driver,
		bool initial_focus,
		const BmsxVideoSurface* surface);
void input_devices_close(void);

void input_devices_poll(void);
int16_t input_devices_state(unsigned port, unsigned device, unsigned index, unsigned id);
bool RETRO_CALLCONV input_devices_supervisor_request_line_high(void);
bool input_devices_quit_requested(void);
