/*
 * mmap_file.h - Memory-mapped file support for BMSX
 *
 * Provides cross-platform memory mapping of files to reduce memory usage
 * when loading ROMs. The mapped file can be used directly without copying
 * into a vector.
 */

#ifndef BMSX_MMAP_FILE_H
#define BMSX_MMAP_FILE_H

#include "core/types.h"
#include <string>
#include <cstddef>

namespace bmsx {

/**
 * Memory-mapped file wrapper.
 * 
 * Maps a file into memory for read-only access. This is more memory efficient
 * than reading the entire file into a vector, especially for large files like
 * ROM images that contain audio data.
 */
class MmapFile {
public:
	MmapFile() = default;
	~MmapFile();

	// Non-copyable
	MmapFile(const MmapFile&) = delete;
	MmapFile& operator=(const MmapFile&) = delete;

	// Movable
	MmapFile(MmapFile&& other) noexcept;
	MmapFile& operator=(MmapFile&& other) noexcept;

	/**
	 * Map a file into memory.
	 * @param path Path to the file to map
	 * @return true if mapping succeeded, false otherwise
	 */
	bool open(const std::string& path);

	/**
	 * Unmap the file from memory.
	 */
	void close();

	/**
	 * Check if a file is currently mapped.
	 */
	bool isOpen() const { return m_data != nullptr; }

	/**
	 * Get a pointer to the mapped data.
	 * @return Pointer to the mapped data, or nullptr if not mapped
	 */
	const u8* data() const { return m_data; }

	/**
	 * Get the size of the mapped file.
	 * @return Size in bytes, or 0 if not mapped
	 */
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
