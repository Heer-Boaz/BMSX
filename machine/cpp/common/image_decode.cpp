#include "common/image_decode.h"

#include "common/primitives.h"
#include "vendor/stb_image.h"

#include <cstring>

namespace bmsx {

DecodedImage decodePngToRgba(const u8* data, size_t size) {
	static constexpr u8 PNG_SIGNATURE[] = { 0x89u, 0x50u, 0x4eu, 0x47u, 0x0du, 0x0au, 0x1au, 0x0au };
	if (size < sizeof(PNG_SIGNATURE) || std::memcmp(data, PNG_SIGNATURE, sizeof(PNG_SIGNATURE)) != 0) {
		throw BMSX_RUNTIME_ERROR("[decodePngToRgba] PNG decode failed.");
	}
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
	DecodedImage image;
	image.width = static_cast<u32>(width);
	image.height = static_cast<u32>(height);
	const size_t byteCount = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
	image.pixels.resize(byteCount);
	std::memcpy(image.pixels.data(), decoded, byteCount);
	stbi_image_free(decoded);
	return image;
}

} // namespace bmsx
