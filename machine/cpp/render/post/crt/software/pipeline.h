/*
 * pipeline.h - Software CRT post-processing pass registration
 */

#ifndef BMSX_CRT_SOFTWARE_PIPELINE_H
#define BMSX_CRT_SOFTWARE_PIPELINE_H

namespace bmsx {

class RenderPassLibrary;

namespace CRTPipeline {

void registerCRTPostSoftwarePass(RenderPassLibrary& registry);

} // namespace CRTPipeline
} // namespace bmsx

#endif // BMSX_CRT_SOFTWARE_PIPELINE_H
