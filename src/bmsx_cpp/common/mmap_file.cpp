/*
 * mmap_file.cpp - Memory-mapped file support for BMSX
 */

#include "mmap_file.h"
#include <stdexcept>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#endif

namespace bmsx {

MmapFile::~MmapFile() {
	close();
}

MmapFile::MmapFile(MmapFile&& other) noexcept
	: m_data(other.m_data)
	, m_size(other.m_size)
#ifdef _WIN32
	, m_file_handle(other.m_file_handle)
	, m_mapping_handle(other.m_mapping_handle)
#else
	, m_fd(other.m_fd)
#endif
{
	other.m_data = nullptr;
	other.m_size = 0;
#ifdef _WIN32
	other.m_file_handle = nullptr;
	other.m_mapping_handle = nullptr;
#else
	other.m_fd = -1;
#endif
}

MmapFile& MmapFile::operator=(MmapFile&& other) noexcept {
	if (this != &other) {
		close();
		m_data = other.m_data;
		m_size = other.m_size;
#ifdef _WIN32
		m_file_handle = other.m_file_handle;
		m_mapping_handle = other.m_mapping_handle;
		other.m_file_handle = nullptr;
		other.m_mapping_handle = nullptr;
#else
		m_fd = other.m_fd;
		other.m_fd = -1;
#endif
		other.m_data = nullptr;
		other.m_size = 0;
	}
	return *this;
}

bool MmapFile::open(const std::string& path) {
	close();

#ifdef _WIN32
	// Windows implementation using CreateFileMapping
	m_file_handle = CreateFileA(
		path.c_str(),
		GENERIC_READ,
		FILE_SHARE_READ,
		nullptr,
		OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL,
		nullptr
	);

	if (m_file_handle == INVALID_HANDLE_VALUE) {
		m_file_handle = nullptr;
		return false;
	}

	LARGE_INTEGER file_size;
	if (!GetFileSizeEx(m_file_handle, &file_size)) {
		CloseHandle(m_file_handle);
		m_file_handle = nullptr;
		return false;
	}

	m_size = static_cast<size_t>(file_size.QuadPart);

	if (m_size == 0) {
		CloseHandle(m_file_handle);
		m_file_handle = nullptr;
		return false;
	}

	m_mapping_handle = CreateFileMappingA(
		m_file_handle,
		nullptr,
		PAGE_READONLY,
		0,
		0,
		nullptr
	);

	if (m_mapping_handle == nullptr) {
		CloseHandle(m_file_handle);
		m_file_handle = nullptr;
		return false;
	}

	m_data = static_cast<const u8*>(MapViewOfFile(
		m_mapping_handle,
		FILE_MAP_READ,
		0,
		0,
		0
	));

	if (m_data == nullptr) {
		CloseHandle(m_mapping_handle);
		CloseHandle(m_file_handle);
		m_mapping_handle = nullptr;
		m_file_handle = nullptr;
		m_size = 0;
		return false;
	}

	return true;

#else
	// POSIX implementation using mmap
	m_fd = ::open(path.c_str(), O_RDONLY);
	if (m_fd < 0) {
		return false;
	}

	struct stat sb;
	if (fstat(m_fd, &sb) < 0) {
		::close(m_fd);
		m_fd = -1;
		return false;
	}

	m_size = static_cast<size_t>(sb.st_size);

	if (m_size == 0) {
		::close(m_fd);
		m_fd = -1;
		return false;
	}

	void* mapped = mmap(nullptr, m_size, PROT_READ, MAP_PRIVATE, m_fd, 0);
	if (mapped == MAP_FAILED) {
		::close(m_fd);
		m_fd = -1;
		m_size = 0;
		return false;
	}

	m_data = static_cast<const u8*>(mapped);
	return true;
#endif
}

void MmapFile::close() {
#ifdef _WIN32
	if (m_data != nullptr) {
		UnmapViewOfFile(m_data);
		m_data = nullptr;
	}
	if (m_mapping_handle != nullptr) {
		CloseHandle(m_mapping_handle);
		m_mapping_handle = nullptr;
	}
	if (m_file_handle != nullptr) {
		CloseHandle(m_file_handle);
		m_file_handle = nullptr;
	}
#else
	if (m_data != nullptr && m_size > 0) {
		munmap(const_cast<u8*>(m_data), m_size);
		m_data = nullptr;
	}
	if (m_fd >= 0) {
		::close(m_fd);
		m_fd = -1;
	}
#endif
	m_size = 0;
}

} // namespace bmsx
