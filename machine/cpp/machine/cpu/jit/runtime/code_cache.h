#pragma once

#include <span>
#include "machine/cpu/jit/limits.h"

namespace bmsx {

class NativeCodeRegion;
struct DecodedInstructionPage;
struct NativeCompilationProfile;

enum class NativeRetirement : u8 { SourceChanged, Feedback, Capacity };
enum class NativeCodeAdmission { Warmup, Adaptive };

// CPU-thread residency, in publication order. The cap covers emitted code
// bytes in published regions, not in-flight work or the host allocator.
class NativeCodeCache {
public:
	explicit NativeCodeCache(size_t capacity = NATIVE_CODE_CACHE_MAX_BYTES) : m_capacity(capacity) {}
	NativeCodeCache(const NativeCodeCache&) = delete;
	NativeCodeCache& operator=(const NativeCodeCache&) = delete;
	size_t codeBytes() const { return m_codeBytes; }
	bool full() const { return m_codeBytes == m_capacity; }
	bool tryInstall(NativeCodeRegion&, std::span<DecodedInstructionPage* const>, NativeCodeAdmission, NativeCompilationProfile*);
	void clear();
private:
	friend class NativeCodeRegion;
	void withdraw(NativeCodeRegion&);
	const size_t m_capacity;
	size_t m_codeBytes = 0;
	NativeCodeRegion* m_oldest = nullptr;
	NativeCodeRegion* m_newest = nullptr;
};

} // namespace bmsx
