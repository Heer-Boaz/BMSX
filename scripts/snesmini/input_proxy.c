#define _GNU_SOURCE

#include "input_merge.h"
#include "keyboard_input.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/uinput.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define BITS_PER_WORD (sizeof(unsigned long) * 8u)
#define BIT_WORDS(maximum) (((maximum) / BITS_PER_WORD) + 1u)
#define BIT_SET(bits, bit) (((bits)[(bit) / BITS_PER_WORD] >> ((bit) % BITS_PER_WORD)) & 1ul)

static volatile sig_atomic_t stop_requested;

static void request_stop(int signal_number) {
	(void)signal_number;
	stop_requested = 1;
}

static bool configure_virtual_keyboard(int output) {
	struct uinput_user_dev device = {.name = "BMSX Remote Keyboard", .id = {.bustype = BUS_VIRTUAL}};
	if (ioctl(output, UI_SET_PHYS, "bmsx/snesmini-input") < 0
			|| ioctl(output, UI_SET_EVBIT, EV_KEY) < 0) return false;
	for (unsigned code = 0; code < BTN_MISC; ++code) {
		if (keyboard_input_key_from_evdev(code) != RETROK_UNKNOWN
				&& ioctl(output, UI_SET_KEYBIT, code) < 0) return false;
	}
	return write(output, &device, sizeof(device)) == (ssize_t)sizeof(device)
		&& ioctl(output, UI_DEV_CREATE) == 0;
}

static bool configure_virtual_device(int source, int output, struct uinput_user_dev* device,
		unsigned long* keys, unsigned long* axes) {
	if (ioctl(source, EVIOCGNAME(sizeof(device->name)), device->name) < 0
			|| ioctl(source, EVIOCGID, &device->id) < 0
			|| ioctl(source, EVIOCGBIT(EV_KEY, BIT_WORDS(KEY_MAX) * sizeof(*keys)), keys) < 0
			|| ioctl(source, EVIOCGBIT(EV_ABS, BIT_WORDS(ABS_MAX) * sizeof(*axes)), axes) < 0
			|| ioctl(output, UI_SET_PHYS, "bmsx/snesmini-input") < 0
			|| ioctl(output, UI_SET_EVBIT, EV_KEY) < 0) return false;
	for (unsigned code = 0; code <= KEY_MAX; ++code) {
		if (BIT_SET(keys, code) && ioctl(output, UI_SET_KEYBIT, code) < 0) return false;
	}
	bool has_axes = false;
	for (unsigned code = 0; code <= ABS_MAX; ++code) has_axes |= BIT_SET(axes, code) != 0;
	if (has_axes && ioctl(output, UI_SET_EVBIT, EV_ABS) < 0) return false;
	for (unsigned code = 0; code <= ABS_MAX; ++code) {
		if (!BIT_SET(axes, code)) continue;
		struct input_absinfo axis;
		if (ioctl(source, EVIOCGABS(code), &axis) < 0 || ioctl(output, UI_SET_ABSBIT, code) < 0) return false;
		device->absmin[code] = axis.minimum;
		device->absmax[code] = axis.maximum;
		device->absfuzz[code] = axis.fuzz;
		device->absflat[code] = axis.flat;
	}
	return write(output, device, sizeof(*device)) == (ssize_t)sizeof(*device)
		&& ioctl(output, UI_DEV_CREATE) == 0;
}

static bool synchronize_physical(SnesInputMerge* input, int source,
		const unsigned long* keys, const unsigned long* axes) {
	unsigned long down[BIT_WORDS(KEY_MAX)] = {0};
	if (ioctl(source, EVIOCGKEY(sizeof(down)), down) < 0) return false;
	for (unsigned code = 0; code <= KEY_MAX; ++code) {
		if (BIT_SET(keys, code)
				&& !snes_input_merge_key(input, SNES_INPUT_PHYSICAL, code, BIT_SET(down, code) != 0)) return false;
	}
	for (unsigned code = 0; code <= ABS_MAX; ++code) {
		if (!BIT_SET(axes, code)) continue;
		struct input_absinfo axis;
		if (ioctl(source, EVIOCGABS(code), &axis) < 0) return false;
		const struct input_event event = {.type = EV_ABS, .code = code, .value = axis.value};
		if (!snes_input_merge_event(input, SNES_INPUT_PHYSICAL, &event)) return false;
	}
	return snes_input_merge_sync(input);
}

static bool run_udevadm(const char* action, const char* match) {
	const pid_t child = fork();
	if (child < 0) return false;
	if (child == 0) {
		if (action) execl("/usr/bin/udevadm", "udevadm", "trigger", action, "--subsystem-match=input", match, (char*)NULL);
		else execl("/usr/bin/udevadm", "udevadm", "settle", "--timeout=5", (char*)NULL);
		_exit(127);
	}
	int status;
	while (waitpid(child, &status, 0) < 0) {
		if (errno != EINTR) return false;
	}
	return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static bool announce_physical(const char* event_name) {
	char match[64];
	snprintf(match, sizeof(match), "--sysname-match=%s", event_name);
	// Clover retains its old player binding after the virtual pad disappears.
	const bool removed = run_udevadm("--action=remove", match);
	const bool remove_settled = run_udevadm(NULL, NULL);
	const bool added = run_udevadm("--action=add", match);
	const bool add_settled = run_udevadm(NULL, NULL);
	return removed && remove_settled && added && add_settled;
}

static bool proxy_input(SnesInputMerge* input, int source, bool forward_physical,
		const unsigned long* keys, const unsigned long* axes) {
	struct pollfd descriptors[] = {{.fd = STDIN_FILENO, .events = POLLIN},
		{.fd = forward_physical ? source : -1, .events = POLLIN}};
	unsigned char pending[sizeof(struct input_event) * 32];
	size_t pending_count = 0;
	bool dropped = false;
	while (!stop_requested) {
		const int count = poll(descriptors, 2, -1);
		if (count < 0 && errno == EINTR) continue;
		if (count < 0) return false;
		if (descriptors[1].revents & (POLLIN | POLLHUP | POLLERR)) {
			struct input_event events[32];
			const ssize_t bytes = read(source, events, sizeof(events));
			if (bytes < 0 && (errno == EINTR || errno == EAGAIN)) continue;
			if (bytes == 0) { errno = ENODEV; return false; }
			if (bytes < 0) return false;
			for (size_t index = 0; index < (size_t)bytes / sizeof(events[0]); ++index) {
				const struct input_event* event = &events[index];
				if (event->type == EV_SYN && event->code == SYN_DROPPED) dropped = true;
				else if (dropped && event->type == EV_SYN && event->code == SYN_REPORT) {
					if (!synchronize_physical(input, source, keys, axes)) return false;
					dropped = false;
				} else if (!dropped && !snes_input_merge_event(input, SNES_INPUT_PHYSICAL, event)) return false;
			}
		}
		if (descriptors[0].revents & (POLLIN | POLLHUP | POLLERR)) {
			const ssize_t bytes = read(STDIN_FILENO, pending + pending_count, sizeof(pending) - pending_count);
			if (bytes < 0 && errno == EINTR) continue;
			if (bytes < 0) return false;
			if (bytes == 0) return true;
			pending_count += (size_t)bytes;
			size_t consumed = 0;
			while (pending_count - consumed >= sizeof(struct input_event)) {
				struct input_event event;
				memcpy(&event, pending + consumed, sizeof(event));
				if (!snes_input_merge_event(input, SNES_INPUT_REMOTE, &event)) return false;
				consumed += sizeof(event);
			}
			pending_count -= consumed;
			memmove(pending, pending + consumed, pending_count);
		}
	}
	return true;
}

int main(int argc, char** argv) {
	const bool keyboard = argc == 2 && strcmp(argv[1], "keyboard") == 0;
	if (!keyboard && (argc != 3 || (strcmp(argv[1], "controller") != 0 && strcmp(argv[1], "reset") != 0))) {
		fprintf(stderr, "Usage: bmsx_snesmini_input controller|reset /dev/input/eventN | keyboard\n");
		return 2;
	}
	const bool forward_physical = !keyboard && strcmp(argv[1], "controller") == 0;
	const int source = keyboard ? -1 : open(argv[2], O_RDONLY | O_NONBLOCK);
	if (!keyboard && source < 0) { perror("open physical input"); return 1; }
	const int output = open("/dev/uinput", O_WRONLY);
	if (output < 0) { perror("open uinput"); if (!keyboard) close(source); return 1; }
	struct sigaction action = {.sa_handler = request_stop};
	sigemptyset(&action.sa_mask);
	sigaction(SIGINT, &action, NULL);
	sigaction(SIGTERM, &action, NULL);
	sigaction(SIGHUP, &action, NULL);
	signal(SIGPIPE, SIG_IGN);
	struct uinput_user_dev device = {0};
	unsigned long keys[BIT_WORDS(KEY_MAX)] = {0}, axes[BIT_WORDS(ABS_MAX)] = {0};
	if (!(keyboard ? configure_virtual_keyboard(output) : configure_virtual_device(source, output, &device, keys, axes))) {
		perror("create virtual input"); close(output); if (!keyboard) close(source); return 1;
	}
	SnesInputMerge input = {.output = output};
	bool ok = !forward_physical || synchronize_physical(&input, source, keys, axes);
	if (!ok) perror("synchronize physical input");
	if (ok && !run_udevadm(NULL, NULL)) {
		fprintf(stderr, "udev did not finish registering the virtual input device\n");
		ok = false;
	}
	if (ok) {
		ok = puts("READY") != EOF && fflush(stdout) != EOF;
		if (!ok) perror("input handshake");
		else {
			ok = proxy_input(&input, source, forward_physical, keys, axes);
			if (!ok) perror("proxy input");
		}
	}
	ioctl(output, UI_DEV_DESTROY);
	close(output);
	if (!keyboard) close(source);
	if (forward_physical) {
		const char* event_name = strrchr(argv[2], '/') + 1;
		if (!announce_physical(event_name)) { fprintf(stderr, "Could not reannounce the physical controller\n"); ok = false; }
	}
	return ok ? 0 : 1;
}
