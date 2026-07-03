/*
 * mmap_file.h - Read-only file mapping for ROM backings.
 */

#ifndef BMSX_MMAP_FILE_H
#define BMSX_MMAP_FILE_H

#include "common/primitives.h"
#include <string>
#include <cstddef>

namespace bmsx {

class MmapFile {
public:
	MmapFile() = default;
	~MmapFile();

	MmapFile(const MmapFile&) = delete;
	MmapFile& operator=(const MmapFile&) = delete;

	MmapFile(MmapFile&& other) noexcept;
	MmapFile& operator=(MmapFile&& other) noexcept;

	bool open(const std::string& path);
	void close();
	bool isOpen() const { return m_data != nullptr; }
	const u8* data() const { return m_data; }
	size_t size() const { return m_size; }

private:
	const u8* m_data = nullptr;
	size_t m_size = 0;

#ifdef _WIN32
	void* m_file_handle = nullptr;
	void* m_mapping_handle = nullptr;
#else
	int m_fd = -1;
#endif
};

} // namespace bmsx

#endif // BMSX_MMAP_FILE_H
