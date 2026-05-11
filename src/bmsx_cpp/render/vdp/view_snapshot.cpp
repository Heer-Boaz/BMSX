#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/vdp/billboards.h"
#include "render/vdp/skybox.h"
#include "render/vdp/transform.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, VDP& vdp) {
	const VDP::VdpHostOutput output = vdp.readHostOutput();
	view.dither_type = static_cast<GameView::DitherType>(output.ditherType);
	resolveVdpTransformSnapshot(view.vdpTransform, *output.xfMatrixWords, output.xfViewMatrixIndex, output.xfProjectionMatrixIndex);
	commitVdpSkyboxViewState(view, output);
	commitVdpBillboardViewState(view, output);
}

} // namespace bmsx
