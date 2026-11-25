#include "machine/cpu/jit/runtime/code_cache.h"

#include <algorithm>
#include <chrono>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/runtime/compilation_profile.h"

namespace bmsx {

bool NativeCodeCache::tryInstall(NativeCodeRegion& region, std::span<DecodedInstructionPage* const> pages,
	NativeCodeAdmission admission, NativeCompilationProfile* profile) {
	if (region.codeBytes > m_capacity) return false;
	if (region.codeBytes > m_capacity - m_codeBytes) {
		if (admission == NativeCodeAdmission::Warmup) return false;
		using Clock = std::chrono::steady_clock;
		const auto start = profile ? Clock::now() : Clock::time_point{};
		const size_t before = m_codeBytes;
		do {
			auto* victim = m_oldest;
			victim->retire(NativeRetirement::Capacity);
			if (profile) ++profile->capacityEvictedRegions;
		} while (region.codeBytes > m_capacity - m_codeBytes);
		if (profile) {
			profile->capacityRetiredCodeBytes += before - m_codeBytes;
			const u64 elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
				Clock::now() - start).count());
			profile->retirementNanoseconds += elapsed;
			profile->prepareNanoseconds += elapsed;
		}
	}
	region.synchronizeInstructionStream();
	region.m_cache = this;
	std::ranges::copy(pages, region.m_pages.begin());
	region.m_pageCount = static_cast<u8>(pages.size());
	region.m_older = m_newest;
	if (m_newest) m_newest->m_newer = &region;
	else m_oldest = &region;
	m_newest = &region;
	m_codeBytes += region.codeBytes;
	return true;
}

void NativeCodeCache::clear() {
	while (m_oldest)
		m_oldest->retire(NativeRetirement::SourceChanged);
}

void NativeCodeCache::withdraw(NativeCodeRegion& region) {
	if (region.m_older) region.m_older->m_newer = region.m_newer;
	else m_oldest = region.m_newer;
	if (region.m_newer) region.m_newer->m_older = region.m_older;
	else m_newest = region.m_older;
	m_codeBytes -= region.codeBytes;
	region.m_cache = nullptr;
	region.m_pageCount = 0;
	region.m_older = nullptr;
	region.m_newer = nullptr;
}

void NativeCodeRegion::withdrawFromCache() {
	if (m_cache) m_cache->withdraw(*this);
}

} // namespace bmsx
