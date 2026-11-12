#define _GNU_SOURCE

#include <errno.h>
#include <linux/input.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int fake_ioctl(int fd, unsigned long request, ...) {
	(void)fd;
	va_list args;
	va_start(args, request);
	void* destination = va_arg(args, void*);
	va_end(args);
	if (_IOC_NR(request) == _IOC_NR(EVIOCGKEY(0))) {
		memset(destination, 0, _IOC_SIZE(request));
		((unsigned long*)destination)[BTN_B / (sizeof(unsigned long) * 8)] |=
			1ul << (BTN_B % (sizeof(unsigned long) * 8));
		return 0;
	}
	errno = EINVAL;
	return -1;
}

#define ioctl fake_ioctl
#define main snesmini_input_proxy_main
#include "../../scripts/snesmini/input_proxy.c"
#undef main
#undef ioctl

static void require(bool condition, const char* message) {
	if (!condition) { fprintf(stderr, "%s\n", message); exit(1); }
}

static void write_event(int fd, unsigned type, unsigned code, int value) {
	const struct input_event event = {.type = type, .code = code, .value = value};
	require(write(fd, &event, sizeof(event)) == sizeof(event), "a full source event is written");
}

static void expect_event(int fd, unsigned type, unsigned code, int value) {
	struct input_event event;
	require(read(fd, &event, sizeof(event)) == sizeof(event), "a full virtual event is delivered");
	require(event.type == type && event.code == code && event.value == value, "virtual event matches the merged state");
}

int main(void) {
	int remote[2], physical[2], output[2];
	require(pipe(remote) == 0 && pipe(physical) == 0 && pipe(output) == 0, "the test owns its streams");
	const pid_t child = fork();
	require(child >= 0, "the input owner runs in a child process");
	if (child == 0) {
		close(remote[1]); close(physical[1]); close(output[0]);
		require(dup2(remote[0], STDIN_FILENO) >= 0, "the remote stream is stdin");
		close(remote[0]);
		SnesInputMerge input = {.output = output[1]};
		unsigned long keys[BIT_WORDS(KEY_MAX)] = {0}, axes[BIT_WORDS(ABS_MAX)] = {0};
		keys[BTN_A / BITS_PER_WORD] |= 1ul << (BTN_A % BITS_PER_WORD);
		keys[BTN_B / BITS_PER_WORD] |= 1ul << (BTN_B % BITS_PER_WORD);
		const bool ok = proxy_input(&input, physical[0], true, keys, axes);
		close(physical[0]); close(output[1]);
		_exit(ok ? 0 : 1);
	}
	close(remote[0]); close(physical[0]); close(output[1]);
	// The SSH byte stream need not split at the 32-bit input_event boundary.
	const struct input_event down = {.type = EV_KEY, .code = BTN_START, .value = 1};
	require(write(remote[1], &down, 5) == 5, "the first fragment is sent");
	require(write(remote[1], (const char*)&down + 5, sizeof(down) - 5) == (ssize_t)sizeof(down) - 5,
		"the remaining fragment is sent");
	write_event(remote[1], EV_SYN, SYN_REPORT, 0);
	expect_event(output[0], EV_KEY, BTN_START, 1);
	expect_event(output[0], EV_SYN, SYN_REPORT, 0);
	write_event(physical[1], EV_SYN, SYN_DROPPED, 0);
	write_event(physical[1], EV_KEY, BTN_A, 1); // ignored while resynchronizing
	write_event(physical[1], EV_SYN, SYN_REPORT, 0);
	expect_event(output[0], EV_KEY, BTN_B, 1);
	expect_event(output[0], EV_SYN, SYN_REPORT, 0);
	write_event(remote[1], EV_KEY, BTN_START, 0);
	write_event(remote[1], EV_SYN, SYN_REPORT, 0);
	expect_event(output[0], EV_KEY, BTN_START, 0);
	expect_event(output[0], EV_SYN, SYN_REPORT, 0);
	close(remote[1]);
	int status;
	require(waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 0,
		"disconnect terminates the input stream cleanly");
	close(physical[1]); close(output[0]);
	puts("SNES Mini input proxy stream tests passed");
	return 0;
}
