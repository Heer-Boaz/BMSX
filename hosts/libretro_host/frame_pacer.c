#include "frame_pacer.h"

void bmsx_frame_pacer_init(BmsxFramePacer* pacer, uint64_t now_ns, uint64_t frame_period_ns) {
	pacer->frame_period_ns = frame_period_ns;
	pacer->next_deadline_ns = now_ns;
	pacer->previous_frame_start_ns = 0u;
	pacer->has_previous_frame = false;
}

BmsxFramePacerDecision bmsx_frame_pacer_begin(BmsxFramePacer* pacer, uint64_t now_ns) {
	BmsxFramePacerDecision decision = {
		.elapsed_ns = pacer->has_previous_frame ? now_ns - pacer->previous_frame_start_ns : 0u,
		.has_elapsed = pacer->has_previous_frame,
		.drop_presentation = now_ns >= pacer->next_deadline_ns + pacer->frame_period_ns,
	};
	pacer->previous_frame_start_ns = now_ns;
	pacer->has_previous_frame = true;
	return decision;
}

void bmsx_frame_pacer_complete(BmsxFramePacer* pacer, uint64_t now_ns, bool paced, uint64_t next_frame_period_ns) {
	pacer->frame_period_ns = next_frame_period_ns;
	pacer->next_deadline_ns = paced ? pacer->next_deadline_ns + next_frame_period_ns : now_ns;
}
