#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct BmsxFramePacer {
	uint64_t frame_period_ns;
	uint64_t next_deadline_ns;
	uint64_t previous_frame_start_ns;
	bool has_previous_frame;
	bool retained_slot;
} BmsxFramePacer;

typedef struct BmsxFramePacerDecision {
	uint64_t elapsed_ns;
	uint64_t finish_deadline_ns;
	bool has_elapsed;
	bool drop_presentation;
	bool retain_frame_grant;
} BmsxFramePacerDecision;

void bmsx_frame_pacer_init(BmsxFramePacer* pacer, uint64_t now_ns, uint64_t frame_period_ns);
BmsxFramePacerDecision bmsx_frame_pacer_begin(BmsxFramePacer* pacer, uint64_t now_ns, bool paced);
void bmsx_frame_pacer_complete(BmsxFramePacer* pacer, uint64_t now_ns, bool paced,
		uint64_t next_frame_period_ns, bool maintenance_only);
