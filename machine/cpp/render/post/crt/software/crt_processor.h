/*
 * crt_processor.h - Software CRT post processor
 */

#ifndef BMSX_CRT_SOFTWARE_PROCESSOR_H
#define BMSX_CRT_SOFTWARE_PROCESSOR_H

namespace bmsx {

class SoftwareBackend;
struct CRTPipelineState;

namespace CRTPipeline {
namespace Software {

void renderCRT(SoftwareBackend& backend, const CRTPipelineState& state);

} // namespace Software
} // namespace CRTPipeline
} // namespace bmsx

#endif // BMSX_CRT_SOFTWARE_PROCESSOR_H
