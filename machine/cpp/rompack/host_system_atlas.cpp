#include "rompack/host_system_atlas.h"

#include <stdexcept>
#include <string>

namespace bmsx {

const HostSystemAtlasImage& hostSystemAtlasImage(std::string_view id) {
	size_t first = 0u;
	size_t last = HOST_SYSTEM_ATLAS.images.size();
	while (first < last) {
		const size_t middle = (first + last) >> 1u;
		const HostSystemAtlasImage& image = HOST_SYSTEM_ATLAS.images[middle];
		const int order = image.id.compare(id);
		if (order < 0) {
			first = middle + 1u;
		} else if (order > 0) {
			last = middle;
		} else {
			return image;
		}
	}
	throw std::runtime_error("Image '" + std::string(id) + "' is not in the host system atlas.");
}

} // namespace bmsx
