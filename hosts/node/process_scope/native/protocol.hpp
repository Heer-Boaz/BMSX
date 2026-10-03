#pragma once

#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#ifdef _WIN32
#include <io.h>
// The supervisor uses separate request/status pipe handles. Windows synchronous
// pipes serialize I/O on a handle, so a blocking read must not share its handle
// with exit notifications.
inline int scope_read(int fd, void* data, unsigned size) {
	DWORD count;
	if (ReadFile(reinterpret_cast<HANDLE>(_get_osfhandle(fd)), data, size, &count, nullptr)) return static_cast<int>(count);
	if (GetLastError() == ERROR_BROKEN_PIPE) return 0;
	errno = EIO;
	return -1;
}
inline int scope_write(int fd, const void* data, unsigned size) {
	DWORD count;
	if (WriteFile(reinterpret_cast<HANDLE>(_get_osfhandle(fd)), data, size, &count, nullptr)) return static_cast<int>(count);
	errno = EPIPE;
	return -1;
}
#define scope_close _close
#else
#include <unistd.h>
#define scope_read read
#define scope_write write
#define scope_close close
#endif

// Private, build-matched supervisor ABI. fd 3 (requests) and fd 4 (status) are
// never inherited by the workload.
// stdin/stdout/stderr belong directly to the workload, not to a JSON relay.
struct ScopeError { const char* operation; int code; };
struct HostClosed {};

inline bool read_exact(void* data, uint32_t size) {
	auto* bytes = static_cast<char*>(data);
	while (size) {
		const auto count = scope_read(3, bytes, size);
		if (count == 0) return false; // The host died or closed its control channel.
		if (count < 0) {
			if (errno == EINTR) continue;
			throw ScopeError{"control_read", errno};
		}
		bytes += count;
		size -= static_cast<uint32_t>(count);
	}
	return true;
}

inline bool status(const char* text) {
	const char* end = text;
	while (*end) ++end;
	while (text != end) {
		const auto count = scope_write(4, text, static_cast<unsigned>(end - text));
		if (count < 0) {
			if (errno == EINTR) continue;
			return false; // Loss of the observer must not interrupt process cleanup.
		}
		text += count;
	}
	return true;
}

inline void report_error(const ScopeError& error) {
	char line[160];
	std::snprintf(line, sizeof line, "error\t%s\t%d\n", error.operation, error.code);
	status(line);
}

inline uint32_t read_word() {
	unsigned char bytes[4];
	if (!read_exact(bytes, sizeof bytes)) throw HostClosed{};
	return bytes[0] | uint32_t(bytes[1]) << 8 | uint32_t(bytes[2]) << 16 | uint32_t(bytes[3]) << 24;
}

inline std::string read_string() {
	std::string value(read_word(), '\0');
	if (!read_exact(value.data(), static_cast<uint32_t>(value.size()))) throw HostClosed{};
	return value;
}

inline std::vector<std::string> read_strings() {
	std::vector<std::string> values;
	const auto count = read_word();
	values.reserve(count);
	for (uint32_t i = 0; i != count; ++i) values.push_back(read_string());
	return values;
}

struct Launch {
	std::string cwd = read_string();
	std::vector<std::string> args = read_strings();
	std::vector<std::string> env = read_strings();
};

inline void workload_exit(int64_t code, int signal) {
	char line[96];
	std::snprintf(line, sizeof line, "exit\t%lld\t%d\n", static_cast<long long>(code), signal);
	status(line);
}

inline void drained() {
	for (int fd = 0; fd != 3; ++fd) scope_close(fd);
	status("drained\n");
}
