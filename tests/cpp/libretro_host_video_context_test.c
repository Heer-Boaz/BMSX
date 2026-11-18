#include "video_context.h"

#include <fcntl.h>
#include <linux/fb.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

#define CHECK(condition) do { \
	if (!(condition)) { \
		fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); \
		abort(); \
	} \
} while (0)

enum { kFramebufferFd = 41, kDisplayFd = 42, kWidth = 32, kHeight = 16 };
static unsigned char framebuffer[kWidth * kHeight * 4];
static struct {
	unsigned long dimming;
	unsigned display_opens, display_writes, display_closes;
	unsigned framebuffer_closes, unmaps;
} device;

int __wrap_open(const char* path, int flags, ...) {
	if (strcmp(path, "/dev/fb0") == 0) {
		CHECK(flags == O_RDWR);
		return kFramebufferFd;
	}
	CHECK(strcmp(path, "/dev/disp") == 0);
	CHECK(flags == (O_RDWR | O_CLOEXEC));
	device.display_opens++;
	return kDisplayFd;
}

int __wrap_ioctl(int fd, unsigned long request, ...) {
	va_list arguments;
	va_start(arguments, request);
	if (fd == kDisplayFd) {
		CHECK(request == 0x111); // Nintendo SUNXI LCD_SET_DIMMING ABI.
		const unsigned long* words = va_arg(arguments, const unsigned long*);
		CHECK(words[0] == 0 && words[1] == 0 && words[2] == 0 && words[3] == 0);
		device.dimming = words[1];
		device.display_writes++;
	} else {
		CHECK(fd == kFramebufferFd);
		if (request == FBIOGET_FSCREENINFO) {
			struct fb_fix_screeninfo* info = va_arg(arguments, struct fb_fix_screeninfo*);
			*info = (struct fb_fix_screeninfo){.line_length = kWidth * 4, .smem_len = sizeof(framebuffer)};
		} else {
			CHECK(request == FBIOGET_VSCREENINFO);
			struct fb_var_screeninfo* info = va_arg(arguments, struct fb_var_screeninfo*);
			*info = (struct fb_var_screeninfo){.xres = kWidth, .yres = kHeight, .bits_per_pixel = 32};
		}
	}
	va_end(arguments);
	return 0;
}

int __wrap_close(int fd) {
	if (fd == kDisplayFd) device.display_closes++;
	else {
		CHECK(fd == kFramebufferFd);
		device.framebuffer_closes++;
	}
	return 0;
}

void* __wrap_mmap(void* address, size_t length, int protection, int flags, int fd, off_t offset) {
	CHECK(address == NULL && length == sizeof(framebuffer));
	CHECK(protection == (PROT_READ | PROT_WRITE) && flags == MAP_SHARED);
	CHECK(fd == kFramebufferFd && offset == 0);
#ifdef BMSX_LIBRETRO_HOST_SNESMINI
	CHECK(device.dimming == 0); // Undim before the host can publish its first frame.
	CHECK(device.display_writes == 1 && device.display_closes == 1);
#else
	CHECK(device.display_opens == 0); // Generic fbdev must not access SUNXI devices.
#endif
	return framebuffer;
}

int __wrap_munmap(void* address, size_t length) {
	CHECK(address == framebuffer && length == sizeof(framebuffer));
	device.unmaps++;
	return 0;
}

int main(void) {
	const unsigned long initial_dimming[] = {1, 0, 1};
	for (unsigned i = 0; i < sizeof(initial_dimming) / sizeof(initial_dimming[0]); ++i) {
		memset(&device, 0, sizeof(device));
		device.dimming = initial_dimming[i];
		BmsxVideoSurface* surface = bmsx_video_context_open(BMSX_VIDEO_CONTEXT_FBDEV, false);
		CHECK(surface->pixels == framebuffer);
		CHECK(surface->width == kWidth && surface->height == kHeight);
		CHECK(surface->stride == kWidth * 4 && surface->bits_per_pixel == 32);
		bmsx_video_context_close();
		CHECK(device.framebuffer_closes == 1 && device.unmaps == 1);
#ifdef BMSX_LIBRETRO_HOST_SNESMINI
		CHECK(device.dimming == 0); // Do not restore Clover's stale dimming on close.
		CHECK(device.display_opens == 1 && device.display_writes == 1 && device.display_closes == 1);
#else
		CHECK(device.dimming == initial_dimming[i]);
		CHECK(device.display_opens == 0 && device.display_writes == 0 && device.display_closes == 0);
#endif
	}
	return 0;
}
