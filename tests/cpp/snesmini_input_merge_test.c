#define _GNU_SOURCE
#include "input_merge.h"

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static void require(bool condition, const char* message) {
	if (!condition) { fprintf(stderr, "%s\n", message); exit(1); }
}

static void event(SnesInputMerge* input, SnesInputSource source, unsigned type, unsigned code, int value) {
	const struct input_event next = {.type = type, .code = code, .value = value};
	require(snes_input_merge_event(input, source, &next), "input event is published");
}

static void sync_report(SnesInputMerge* input, SnesInputSource source) {
	event(input, source, EV_SYN, SYN_REPORT, 0);
}

static void expect_event(int fd, unsigned type, unsigned code, int value) {
	struct input_event actual;
	require(read(fd, &actual, sizeof(actual)) == sizeof(actual), "one complete input event is delivered");
	require(actual.type == type && actual.code == code && actual.value == value,
		"the virtual input event has the expected type, code and value");
}

static void expect_empty(int fd) {
	struct input_event unexpected;
	require(read(fd, &unexpected, sizeof(unexpected)) < 0, "no redundant input report is emitted");
}

int main(void) {
	int pipe_fds[2];
	require(pipe2(pipe_fds, O_NONBLOCK) == 0, "the test owns a nonblocking event sink");
	SnesInputMerge input = {.output = pipe_fds[1]};

	// Remote holds remain down while the physical device reports the same key.
	event(&input, SNES_INPUT_REMOTE, EV_KEY, BTN_START, 1);
	sync_report(&input, SNES_INPUT_REMOTE);
	expect_event(pipe_fds[0], EV_KEY, BTN_START, 1);
	expect_event(pipe_fds[0], EV_SYN, SYN_REPORT, 0);
	event(&input, SNES_INPUT_PHYSICAL, EV_KEY, BTN_START, 1);
	sync_report(&input, SNES_INPUT_PHYSICAL);
	event(&input, SNES_INPUT_PHYSICAL, EV_KEY, BTN_START, 0);
	sync_report(&input, SNES_INPUT_PHYSICAL);
	expect_empty(pipe_fds[0]);
	event(&input, SNES_INPUT_REMOTE, EV_KEY, BTN_START, 0);
	sync_report(&input, SNES_INPUT_REMOTE);
	expect_event(pipe_fds[0], EV_KEY, BTN_START, 0);
	expect_event(pipe_fds[0], EV_SYN, SYN_REPORT, 0);

	// In the reverse order, remote release must not erase the physical hold.
	event(&input, SNES_INPUT_PHYSICAL, EV_KEY, BTN_A, 1);
	sync_report(&input, SNES_INPUT_PHYSICAL);
	event(&input, SNES_INPUT_REMOTE, EV_KEY, BTN_A, 1);
	event(&input, SNES_INPUT_REMOTE, EV_KEY, BTN_A, 0);
	sync_report(&input, SNES_INPUT_REMOTE);
	event(&input, SNES_INPUT_PHYSICAL, EV_KEY, BTN_A, 0);
	sync_report(&input, SNES_INPUT_PHYSICAL);
	expect_event(pipe_fds[0], EV_KEY, BTN_A, 1);
	expect_event(pipe_fds[0], EV_SYN, SYN_REPORT, 0);
	expect_event(pipe_fds[0], EV_KEY, BTN_A, 0);
	expect_event(pipe_fds[0], EV_SYN, SYN_REPORT, 0);
	expect_empty(pipe_fds[0]);

	// One report preserves simultaneous controls, and physical axes pass through.
	event(&input, SNES_INPUT_REMOTE, EV_KEY, BTN_SELECT, 1);
	event(&input, SNES_INPUT_REMOTE, EV_KEY, BTN_START, 1);
	sync_report(&input, SNES_INPUT_REMOTE);
	event(&input, SNES_INPUT_PHYSICAL, EV_ABS, ABS_X, -72);
	sync_report(&input, SNES_INPUT_PHYSICAL);
	expect_event(pipe_fds[0], EV_KEY, BTN_SELECT, 1);
	expect_event(pipe_fds[0], EV_KEY, BTN_START, 1);
	expect_event(pipe_fds[0], EV_SYN, SYN_REPORT, 0);
	expect_event(pipe_fds[0], EV_ABS, ABS_X, -72);
	expect_event(pipe_fds[0], EV_SYN, SYN_REPORT, 0);
	expect_empty(pipe_fds[0]);
	close(pipe_fds[0]); close(pipe_fds[1]);
	puts("SNES Mini input merge tests passed");
	return 0;
}
