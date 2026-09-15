#pragma once
#include <stdbool.h>
#include <stdint.h>

void host_control_open(uint16_t port);
void host_control_poll(void);
void host_control_after_frame(bool presented);
bool host_control_quit_requested(void);
bool host_control_capture_pending(void);
void host_control_capture_complete(uint32_t width, uint32_t height, bool saved);
const char* host_control_capture_filename(void);
void host_control_close(void);
