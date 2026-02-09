# DKC Movement Frame Notes

Primary disassembly anchors (as documented in this repo history):
- `Yoshifanatic1/Donkey-Kong-Country-1-Disassembly`
- commit: `c2080f40469c716923f550706509a0d354229841`
- file: `Routine_Macros_DKC1.asm`
- routines: `CODE_BFB538`, `CODE_BFB573`, `CODE_BFB159`, `DATA_BFB255`, `CODE_BFBD4F`, `CODE_BFBDA9`, `CODE_BFBDE7`

Local source snapshots used:
- `src/carts/esther/constants.lua` at commit `1c4122d5`
- `src/carts/esther/player.lua` at commit `1c4122d5`

Rules used for the frame tables:
- Speeds are in subpixels/frame (`0x0100 = 256 = 1 px/frame`).
- Position update per frame: `pos_subpx += speed_subpx`.
- Pixel movement per frame: `delta_px = floor(pos_subpx/256)_new - floor(pos_subpx/256)_old`.
- Horizontal approach uses `DATA_BFB255` profile divisors:
  - `0=/8`, `1=/16`, `2=/32`, `3=/64`, `4=/128`, `5=/256`, `6=/4`, `7=/2`, `8=/32 + /64`.
- Every case is simulated until `speed_subpx == target_speed_subpx`.

Generated frame-by-frame output:
- `src/carts/esther/test/dkc_motion_frame_table.csv`

Case summaries:
- `ground_walk_accel` profile=3, start=0, target=512, frames_to_target=166, final_speed=512 (2.000000 px/f), first_delta1=8, first_delta2=58, first_delta3=null, first_negative_delta=null, delta_counts={0:21, 1:89, 2:56}
- `ground_run_accel` profile=8, start=0, target=768, frames_to_target=91, final_speed=768 (3.000000 px/f), first_delta1=4, first_delta2=12, first_delta3=29, first_negative_delta=null, delta_counts={0:4, 1:11, 2:33, 3:43}
- `ground_release_decel` profile=3, start=768, target=0, frames_to_target=193, final_speed=0 (0.000000 px/f), first_delta1=29, first_delta2=1, first_delta3=2, first_negative_delta=null, delta_counts={0:56, 1:90, 2:35, 3:12}
- `ground_turn_right_to_left` profile=3, start=768, target=-512, frames_to_target=227, final_speed=-512 (-2.000000 px/f), first_delta1=19, first_delta2=1, first_delta3=2, first_negative_delta=65, delta_counts={-2:56, -1:90, 0:35, 1:23, 2:17, 3:6}
- `air_control_accel` profile=0, start=0, target=512, frames_to_target=37, final_speed=512 (2.000000 px/f), first_delta1=3, first_delta2=9, first_delta3=null, first_negative_delta=null, delta_counts={0:2, 1:11, 2:24}
- `roll_decay_4px_to_2px` profile=0, start=1024, target=512, frames_to_target=37, final_speed=512 (2.000000 px/f), first_delta1=null, first_delta2=9, first_delta3=1, first_negative_delta=null, delta_counts={2:24, 3:12, 4:1}
