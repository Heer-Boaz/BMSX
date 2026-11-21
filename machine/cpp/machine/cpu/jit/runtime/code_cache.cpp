#include "machine/cpu/jit/runtime/code_cache.h"

#include <chrono>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/runtime/compilation_profile.h"

namespace bmsx {

bool NativeCodeCache::tryInstall(NativeCodeRegion& region, DecodedInstructionPage& page,
	NativeCodeAdmission admission, NativeCompilationProfile* profile) {
	if (region.codeBytes > m_capacity) return false;
	if (region.codeBytes > m_capacity - m_codeBytes) {
		if (admission == NativeCodeAdmission::Warmup) return false;
		using Clock = std::chrono::steady_clock;
		const auto start = profile ? Clock::now() : Clock::time_point{};
		const size_t before = m_codeBytes;
		do {
			auto* victim = m_oldest;
			victim->m_page->retireNativeRegion(victim, DecodedInstructionPage::Retirement::Capacity);
			if (profile) ++profile->capacityEvictedRegions;
		} while (region.codeBytes > m_capacity - m_codeBytes);
		if (profile) {
			profile->capacityRetiredCodeBytes += before - m_codeBytes;
			profile->retirementNanoseconds += static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
				Clock::now() - start).count());
		}
	}
	region.m_cache = this;
	region.m_page = &page;
	region.m_older = m_newest;
	if (m_newest) m_newest->m_newer = &region;
	else m_oldest = &region;
	m_newest = &region;
	region.publish(m_codeBytes);
	return true;
}

void NativeCodeRegion::withdrawFromCache() {
	if (!m_cache) return;
	if (m_older) m_older->m_newer = m_newer;
	else m_cache->m_oldest = m_newer;
	if (m_newer) m_newer->m_older = m_older;
	else m_cache->m_newest = m_older;
	m_cache->m_codeBytes -= codeBytes;
	m_cache = nullptr;
	m_page = nullptr;
	m_older = nullptr;
	m_newer = nullptr;
	m_cacheBytes = nullptr;
}

} // namespace bmsx
