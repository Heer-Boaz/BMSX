#pragma once

#include "common/types.h"

#include <cstddef>

namespace bmsx {

class ApuOutputRing;

class AudioOutputResampler final {
public:
	void reset();
	[[nodiscard]] auto pull(
		ApuOutputRing& ring,
		i16* output,
		size_t frameCount,
		i32 outputSampleRate
	) -> size_t;

private:
	[[nodiscard]] auto prime(ApuOutputRing& ring) -> bool;
	void readNext(ApuOutputRing& ring);

	i32 m_outputRate = 0;
	f64 m_phase = 0.0;
	bool m_hasCurrent = false;
	bool m_hasNext = false;
	i64 m_lastSourceSequence = 0;
	i32 m_currentLeft = 0;
	i32 m_currentRight = 0;
	i32 m_nextLeft = 0;
	i32 m_nextRight = 0;
};

} // namespace bmsx
