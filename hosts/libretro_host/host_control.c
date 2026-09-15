#define _GNU_SOURCE
#include "host_control.h"
#include "control_transport.h"
#include "host_fatal.h"
#include "input_devices.h"
#include "keyboard_input.h"
#include "screenshot.h"
#include "cJSON.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum { CONTROL_IDLE, CONTROL_WAIT, CONTROL_CAPTURE, CONTROL_QUIT } ControlPending;
static struct {
	bool enabled;
	ControlTransport transport;
	ControlPending pending;
	double request_id;
	uint64_t host_frame;
	uint64_t presentation_frame;
	uint64_t wait_target;
	char capture_directory[128];
	char capture_filename[64];
} control;

static void reply(cJSON* result, const char* error) {
	cJSON* response = cJSON_CreateObject();
	cJSON_AddNumberToObject(response, "id", control.request_id);
	if (error) cJSON_AddStringToObject(response, "error", error);
	else cJSON_AddItemToObject(response, "result", result);
	char* text = cJSON_PrintUnformatted(response);
	control_transport_reply(&control.transport, text);
	cJSON_free(text);
	cJSON_Delete(response);
}

static bool apply_input(const cJSON* events) {
	if (!cJSON_IsArray(events)) return false;
	const cJSON* event;
	cJSON_ArrayForEach(event, events) {
		const char* type = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(event, "type"));
		if (!type) return false;
		if (strcmp(type, "key") == 0) {
			const char* code = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(event, "code"));
			const cJSON* down = cJSON_GetObjectItemCaseSensitive(event, "down");
			if (!code || !cJSON_IsBool(down)) return false;
			const enum retro_key key = keyboard_input_key_from_code(code);
			if (key == RETROK_UNKNOWN) return false;
			keyboard_input_post(KEYBOARD_INPUT_SOURCE_REMOTE, key, cJSON_IsTrue(down));
		} else if (strcmp(type, "pointer") == 0) {
			const cJSON* x = cJSON_GetObjectItemCaseSensitive(event, "x");
			const cJSON* y = cJSON_GetObjectItemCaseSensitive(event, "y");
			if (!cJSON_IsNumber(x) || !cJSON_IsNumber(y)) return false;
			input_devices_remote_pointer(x->valueint, y->valueint);
		} else if (strcmp(type, "button") == 0) {
			const char* button = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(event, "button"));
			const cJSON* down = cJSON_GetObjectItemCaseSensitive(event, "down");
			if (!button || !cJSON_IsBool(down)) return false;
			static const char* names[] = { "primary", "secondary", "aux", "back", "forward" };
			unsigned index = 0;
			for (; index < 5; ++index) if (strcmp(button, names[index]) == 0) break;
			if (index == 5) return false;
			input_devices_remote_button(index, cJSON_IsTrue(down));
		} else if (strcmp(type, "wheel") == 0) {
			const cJSON* delta = cJSON_GetObjectItemCaseSensitive(event, "deltaY");
			if (!cJSON_IsNumber(delta)) return false;
			input_devices_remote_wheel(delta->valueint);
		} else return false;
	}
	return true;
}

static void execute(const cJSON* request) {
	const cJSON* id = cJSON_GetObjectItemCaseSensitive(request, "id");
	const char* command = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(request, "execute"));
	if (!cJSON_IsNumber(id) || !command) {
		control.request_id = 0;
		reply(NULL, "Expected a numeric id and execute command.");
		return;
	}
	control.request_id = id->valuedouble;
	if (strcmp(command, "input") == 0) {
		if (!apply_input(cJSON_GetObjectItemCaseSensitive(request, "events"))) {
			reply(NULL, "Invalid input event.");
			return;
		}
		control.wait_target = control.host_frame + 1;
		control.pending = CONTROL_WAIT;
	} else if (strcmp(command, "wait") == 0) {
		const cJSON* frames = cJSON_GetObjectItemCaseSensitive(request, "frames");
		if (!cJSON_IsNumber(frames) || !(frames->valuedouble >= 1 && frames->valuedouble <= 9007199254740991.0)) {
			reply(NULL, "wait.frames must be a positive host-frame count.");
			return;
		}
		const uint64_t count = (uint64_t)frames->valuedouble;
		if ((double)count != frames->valuedouble) {
			reply(NULL, "wait.frames must be a positive host-frame count.");
			return;
		}
		control.wait_target = control.host_frame + count;
		control.pending = CONTROL_WAIT;
	} else if (strcmp(command, "capture") == 0) {
		control.pending = CONTROL_CAPTURE;
	} else if (strcmp(command, "quit") == 0) {
		control.pending = CONTROL_QUIT;
		reply(cJSON_CreateObject(), NULL);
	} else if (strcmp(command, "clipboard-get") == 0 || strcmp(command, "clipboard-set") == 0) {
		reply(NULL, "This host has no clipboard.");
	} else reply(NULL, "Unknown host-control command.");
}

void host_control_open(uint16_t port) {
	control.enabled = true;
	strcpy(control.capture_directory, "/tmp/bmsx-control-XXXXXX");
	if (!mkdtemp(control.capture_directory)) host_fatal("Could not create host control capture directory");
	screenshot_set_output_dir(control.capture_directory);
	const uint16_t listening_port = control_transport_open(&control.transport, port);
	printf("{\"hostControl\":{\"port\":%u,\"studio\":false,\"captureDirectory\":\"%s\"}}\n", listening_port, control.capture_directory);
	fflush(stdout);
}

void host_control_poll(void) {
	control_transport_poll(&control.transport, control.pending == CONTROL_IDLE);
	if (control.transport.disconnected) {
		keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_REMOTE);
		input_devices_remote_release();
		if (control.pending != CONTROL_QUIT) control.pending = CONTROL_IDLE;
	}
	if (control.pending != CONTROL_IDLE || control.transport.output) return;
	size_t length;
	const char* line = control_transport_line(&control.transport, &length);
	if (!line) return;
	cJSON* request = cJSON_ParseWithLengthOpts(line, length, NULL, true);
	if (request) execute(request);
	else { control.request_id = 0; reply(NULL, "Invalid JSON request."); }
	cJSON_Delete(request);
	control_transport_consume(&control.transport, length);
}

void host_control_after_frame(bool presented) {
	control.host_frame += 1;
	if (presented) control.presentation_frame += 1;
	if (control.pending == CONTROL_WAIT && control.host_frame >= control.wait_target) {
		control.pending = CONTROL_IDLE;
		cJSON* result = cJSON_CreateObject();
		cJSON_AddNumberToObject(result, "hostFrame", (double)control.host_frame);
		reply(result, NULL);
	}
}

bool host_control_capture_pending(void) {
	return control.enabled && control.pending == CONTROL_CAPTURE;
}

const char* host_control_capture_filename(void) {
	snprintf(control.capture_filename, sizeof(control.capture_filename), "frame_%llu.png", (unsigned long long)control.presentation_frame);
	return control.capture_filename;
}

void host_control_capture_complete(uint32_t width, uint32_t height, bool saved) {
	control.pending = CONTROL_IDLE;
	if (!saved) { reply(NULL, "Screenshot write failed."); return; }
	char image_path[256];
	snprintf(image_path, sizeof(image_path), "%s/%s", control.capture_directory, control.capture_filename);
	cJSON* result = cJSON_CreateObject();
	cJSON_AddNumberToObject(result, "presentationFrame", (double)control.presentation_frame);
	cJSON_AddNumberToObject(result, "width", width);
	cJSON_AddNumberToObject(result, "height", height);
	cJSON_AddStringToObject(result, "path", image_path);
	reply(result, NULL);
}

bool host_control_quit_requested(void) {
	return control.pending == CONTROL_QUIT && !control.transport.output;
}

void host_control_close(void) {
	keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_REMOTE);
	input_devices_remote_release();
	control_transport_close(&control.transport);
}
