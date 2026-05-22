#include "common/image_decode.h"

#include "common/primitives.h"
#include "vendor/stb_image.h"

#include <cstring>

namespace bmsx {

DecodedImage decodePngToRgba(const u8* data, size_t size) {
	int width = 0;
	int height = 0;
	int components = 0;
	unsigned char* decoded = stbi_load_from_memory(
		data,
		static_cast<int>(size),
		&width,
		&height,
		&components,
		STBI_rgb_alpha
	);
	(void)components;
	if (decoded == nullptr || width <= 0 || height <= 0) {
		if (decoded != nullptr) {
			stbi_image_free(decoded);
		}
		throw BMSX_RUNTIME_ERROR("[decodePngToRgba] PNG decode failed.");
	}
	const size_t byteCount = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
	DecodedImage result;
	result.width = static_cast<u32>(width);
	result.height = static_cast<u32>(height);
	result.pixels.resize(byteCount);
	std::memcpy(result.pixels.data(), decoded, byteCount);
	stbi_image_free(decoded);
	return result;
}

} // namespace bmsx
