#define _GNU_SOURCE
#include "control_transport.h"
#include "host_fatal.h"
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/tcp.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static void disconnect_client(ControlTransport* transport) {
	close(transport->client);
	transport->client = -1;
	transport->input_length = 0;
	free(transport->output);
	transport->output = NULL;
	transport->output_length = 0;
	transport->output_offset = 0;
	transport->disconnected = true;
}

uint16_t control_transport_open(ControlTransport* transport, uint16_t port) {
	*transport = (ControlTransport){ .client = -1, .input_capacity = 4096 };
	transport->input = malloc(transport->input_capacity);
	if (!transport->input) host_fatal("Host control allocation failed");
	transport->listener = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
	if (transport->listener < 0) host_fatal("Host control socket: %s", strerror(errno));
	struct sockaddr_in address = { .sin_family = AF_INET, .sin_port = htons(port), .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
	if (bind(transport->listener, (struct sockaddr*)&address, sizeof(address)) != 0 || listen(transport->listener, 1) != 0) {
		host_fatal("Host control listen: %s", strerror(errno));
	}
	socklen_t size = sizeof(address);
	if (getsockname(transport->listener, (struct sockaddr*)&address, &size) != 0) host_fatal("Host control address: %s", strerror(errno));
	return ntohs(address.sin_port);
}

void control_transport_poll(ControlTransport* transport, bool receive) {
	transport->disconnected = false;
	const int incoming = accept4(transport->listener, NULL, NULL, SOCK_NONBLOCK | SOCK_CLOEXEC);
	if (incoming >= 0) {
		if (transport->client >= 0) {
			const char reply[] = "{\"error\":\"A controller is already connected.\"}\n";
			(void)send(incoming, reply, sizeof(reply) - 1, MSG_NOSIGNAL);
			close(incoming);
		} else {
			const int enabled = 1;
			setsockopt(incoming, IPPROTO_TCP, TCP_NODELAY, &enabled, sizeof(enabled));
			transport->client = incoming;
		}
	} else if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
		host_fatal("Host control accept: %s", strerror(errno));
	}
	if (transport->client < 0) return;
	if (transport->output) {
		const ssize_t sent = send(transport->client, transport->output + transport->output_offset,
			transport->output_length - transport->output_offset, MSG_NOSIGNAL);
		if (sent > 0) transport->output_offset += (size_t)sent;
		else if (sent < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
			disconnect_client(transport);
			return;
		}
		if (transport->output_offset == transport->output_length) {
			free(transport->output);
			transport->output = NULL;
		}
	}
	if (!receive || transport->output) {
		char byte;
		const ssize_t received = recv(transport->client, &byte, 1, MSG_PEEK);
		if (received == 0 || (received < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
			disconnect_client(transport);
		}
		return;
	}
	if (transport->input_length == transport->input_capacity) {
		transport->input_capacity *= 2;
		char* input = realloc(transport->input, transport->input_capacity);
		if (!input) host_fatal("Host control receive allocation failed");
		transport->input = input;
	}
	const ssize_t received = recv(transport->client, transport->input + transport->input_length,
		transport->input_capacity - transport->input_length, 0);
	if (received > 0) transport->input_length += (size_t)received;
	else if (received == 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) disconnect_client(transport);
}

const char* control_transport_line(ControlTransport* transport, size_t* length) {
	char* end = memchr(transport->input, '\n', transport->input_length);
	if (!end) return NULL;
	*length = (size_t)(end - transport->input) + 1;
	*end = '\0';
	return transport->input;
}

void control_transport_consume(ControlTransport* transport, size_t length) {
	transport->input_length -= length;
	memmove(transport->input, transport->input + length, transport->input_length);
}

void control_transport_reply(ControlTransport* transport, const char* text) {
	const size_t length = strlen(text);
	transport->output = malloc(length + 1);
	if (!transport->output) host_fatal("Host control reply allocation failed");
	memcpy(transport->output, text, length);
	transport->output[length] = '\n';
	transport->output_length = length + 1;
	transport->output_offset = 0;
}

void control_transport_close(ControlTransport* transport) {
	if (transport->client >= 0) disconnect_client(transport);
	close(transport->listener);
	free(transport->input);
}
