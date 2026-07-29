#include "mem_snapshot.h"

#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

namespace bmsx {

namespace {

struct ProcField {
	const char* key;
	long* value_kb;
};

bool parseLineForField(const std::string& line, const char* key, long& out_kb) {
	const size_t key_len = std::strlen(key);
	if (line.size() <= key_len || line.compare(0, key_len, key) != 0 || line[key_len] != ':') {
		return false;
	}
	std::istringstream iss(line.substr(key_len + 1));
	long value = 0;
	if (!(iss >> value)) {
		return false;
	}
	out_kb = value;
	return true;
}

void readProcFile(const char* path, ProcField* fields, size_t field_count) {
	std::ifstream file(path);
	if (!file) {
		return;
	}
	std::string line;
	while (std::getline(file, line)) {
		for (size_t i = 0; i < field_count; ++i) {
			if (fields[i].value_kb && *fields[i].value_kb < 0) {
				long value = -1;
				if (parseLineForField(line, fields[i].key, value)) {
					*fields[i].value_kb = value;
				}
			}
		}
	}
}

void appendField(std::ostringstream& out, const char* key, long value_kb) {
	if (value_kb >= 0) {
		out << ' ' << key << '=' << value_kb << "kB";
	}
}

} // namespace

std::string memSnapshotLine(const char* label) {
#if defined(__linux__)
	long mem_free = -1;
	long mem_available = -1;
	long buffers = -1;
	long cached = -1;
	long swap_free = -1;
	long slab = -1;
	long vm_rss = -1;
	long vm_size = -1;

	ProcField meminfo_fields[] = {
		{"MemFree", &mem_free},
		{"MemAvailable", &mem_available},
		{"Buffers", &buffers},
		{"Cached", &cached},
		{"SwapFree", &swap_free},
		{"Slab", &slab},
	};
	readProcFile("/proc/meminfo", meminfo_fields, sizeof(meminfo_fields) / sizeof(meminfo_fields[0]));

	ProcField status_fields[] = {
		{"VmRSS", &vm_rss},
		{"VmSize", &vm_size},
	};
	readProcFile("/proc/self/status", status_fields, sizeof(status_fields) / sizeof(status_fields[0]));

	std::ostringstream out;
	out << "[MEM] " << (label ? label : "(snapshot)");
	appendField(out, "VmRSS", vm_rss);
	appendField(out, "VmSize", vm_size);
	appendField(out, "MemFree", mem_free);
	appendField(out, "MemAvail", mem_available);
	appendField(out, "Buffers", buffers);
	appendField(out, "Cached", cached);
	appendField(out, "SwapFree", swap_free);
	appendField(out, "Slab", slab);
	return out.str();
#else
	(void)label;
	return std::string();
#endif
}

} // namespace bmsx
