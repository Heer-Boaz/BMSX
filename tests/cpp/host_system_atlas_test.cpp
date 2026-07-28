#include "render/host_overlay/atlas.h"

#include <cstddef>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

} // namespace

int main() {
	require(
		bmsx::HOST_SYSTEM_ATLAS.pixels.size()
			== static_cast<std::size_t>(bmsx::HOST_SYSTEM_ATLAS.width) * static_cast<std::size_t>(bmsx::HOST_SYSTEM_ATLAS.height) * 4u,
		"host system atlas pixel span should match its dimensions");
	require(!bmsx::HOST_SYSTEM_ATLAS.images.empty(), "host system atlas should contain image descriptors");
	for (std::size_t index = 1u; index < bmsx::HOST_SYSTEM_ATLAS.images.size(); index += 1u) {
		require(
			bmsx::HOST_SYSTEM_ATLAS.images[index - 1u].id < bmsx::HOST_SYSTEM_ATLAS.images[index].id,
			"host system atlas image descriptors should be sorted by id");
	}

	const bmsx::HostSystemAtlasImage& whitePixel = bmsx::hostSystemAtlasImage("whitepixel");
	const std::size_t whitePixelOffset = (
		static_cast<std::size_t>(whitePixel.v) * static_cast<std::size_t>(bmsx::HOST_SYSTEM_ATLAS.width)
		+ static_cast<std::size_t>(whitePixel.u)
	) * 4u;
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset] == 0xffu, "white pixel red channel should be opaque white");
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset + 1u] == 0xffu, "white pixel green channel should be opaque white");
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset + 2u] == 0xffu, "white pixel blue channel should be opaque white");
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset + 3u] == 0xffu, "white pixel alpha channel should be opaque white");

	bool missingImageRejected = false;
	try {
		(void)bmsx::hostSystemAtlasImage("missing_host_atlas_image");
	} catch (const std::runtime_error&) {
		missingImageRejected = true;
	}
	require(missingImageRejected, "host system atlas lookup should reject missing image ids");
	return 0;
}
