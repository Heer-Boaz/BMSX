#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct ControlTransport {
	int listener;
	int client;
	char* input;
	size_t input_length;
	size_t input_capacity;
	char* output;
	size_t output_length;
	size_t output_offset;
	bool disconnected;
} ControlTransport;

uint16_t control_transport_open(ControlTransport* transport, uint16_t port);
void control_transport_poll(ControlTransport* transport, bool receive);
const char* control_transport_line(ControlTransport* transport, size_t* length);
void control_transport_consume(ControlTransport* transport, size_t length);
void control_transport_reply(ControlTransport* transport, const char* text);
void control_transport_close(ControlTransport* transport);
