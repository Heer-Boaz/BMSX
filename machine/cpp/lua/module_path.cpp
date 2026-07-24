#include "lua/module_path.h"

#include <algorithm>

namespace bmsx {

namespace {

bool startsWith(std::string_view value, std::string_view prefix) {
	return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0;
}

bool hasLuaExtension(std::string_view candidate) {
	if (candidate.size() < 4) return false;
	const size_t dotIndex = candidate.size() - 4;
	return candidate[dotIndex] == '.'
		&& (candidate[dotIndex + 1] == 'l' || candidate[dotIndex + 1] == 'L')
		&& (candidate[dotIndex + 2] == 'u' || candidate[dotIndex + 2] == 'U')
		&& (candidate[dotIndex + 3] == 'a' || candidate[dotIndex + 3] == 'A');
}

} // namespace

std::string stripLuaExtension(std::string_view candidate) {
	if (hasLuaExtension(candidate)) candidate.remove_suffix(4);
	return std::string(candidate);
}

std::string toLuaModulePath(std::string_view sourcePath) {
	static constexpr std::string_view CART_SOURCE_PREFIX = "carts/";
	static constexpr std::string_view MODULE_PATH_SOURCE_PREFIXES[] = {
		"machine/firmware/res/",
		"machine/firmware/",
		"res/",
	};
	std::string path = stripLuaExtension(sourcePath);
	std::replace(path.begin(), path.end(), '\\', '/');
	std::string_view modulePath = path;
	if (startsWith(path, CART_SOURCE_PREFIX)) {
		modulePath.remove_prefix(CART_SOURCE_PREFIX.size());
		const size_t cartNameEnd = modulePath.find('/');
		if (cartNameEnd != std::string_view::npos) modulePath.remove_prefix(cartNameEnd + 1);
	} else {
		for (const std::string_view prefix : MODULE_PATH_SOURCE_PREFIXES) {
			if (startsWith(path, prefix)) {
				modulePath.remove_prefix(prefix.size());
				break;
			}
		}
	}
	return std::string(modulePath);
}

} // namespace bmsx
