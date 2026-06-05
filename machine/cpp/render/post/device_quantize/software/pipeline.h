/*
 * pipeline.h - Software device quantize post pass
 */

#ifndef BMSX_DEVICE_QUANTIZE_SOFTWARE_PIPELINE_H
#define BMSX_DEVICE_QUANTIZE_SOFTWARE_PIPELINE_H

namespace bmsx {

class RenderPassLibrary;

namespace DeviceQuantizePipeline {
namespace Software {

void registerPass(RenderPassLibrary& registry);

} // namespace Software
} // namespace DeviceQuantizePipeline
} // namespace bmsx

#endif // BMSX_DEVICE_QUANTIZE_SOFTWARE_PIPELINE_H
