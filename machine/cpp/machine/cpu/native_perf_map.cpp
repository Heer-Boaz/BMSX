#include "machine/cpu/native_perf_map.h"

#include <cerrno>
#include <cinttypes>
#include <cstdio>
#include <mutex>
#include <system_error>
#include <unistd.h>

namespace bmsx {
namespace {

class NativePerfMap {
public:
	NativePerfMap() {
		char path[64];
		std::snprintf(path, sizeof(path), "/tmp/perf-%ld.map", static_cast<long>(getpid()));
		m_file = std::fopen(path, "w");
		if (!m_file) throw std::system_error(errno, std::generic_category(), "open native perf map");
	}
	~NativePerfMap() { std::fclose(m_file); }

	void record(std::span<const NativePerfMapRange> ranges) {
		std::lock_guard lock(m_mutex);
		for (const auto& range : ranges) {
			if (std::fprintf(m_file, "%" PRIxPTR " %zx %s\n", range.start, range.bytes, range.symbol) < 0)
				throw std::system_error(errno, std::generic_category(), "write native perf map");
		}
		if (std::fflush(m_file) != 0)
			throw std::system_error(errno, std::generic_category(), "flush native perf map");
	}

private:
	std::FILE* m_file;
	std::mutex m_mutex;
};

} // namespace

void recordNativePerfMap(std::span<const NativePerfMapRange> ranges) {
	static NativePerfMap map;
	map.record(ranges);
}

} // namespace bmsx
