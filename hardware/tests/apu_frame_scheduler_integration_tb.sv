`timescale 1ns/1ps
// Real timeline, scheduler, upload owner and BADP/biquad/mixer. The source
// cursor and sample RAM backend are controlled fixtures, not a complete APU.
module apu_frame_scheduler_integration_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,busy=0;
 wire frame_valid,frame_ready,frame_done,frame_tick,decoder_begin;
 reg [15:0] active_mask=1;wire worker_start_valid,worker_start_ready,worker_slot_valid,worker_slot_ready,worker_slot_active;
 wire [3:0] worker_slot_index;wire worker_frame_valid,worker_frame_ready;reg output_ready=0;
 wire snapshot_ready,snapshot_overflow,snapshot_history_lost;wire [63:0] pending_frames;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.executor_busy(busy),.snapshot_overflow(snapshot_overflow),.snapshot_history_lost(snapshot_history_lost),.timeline_ready(),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.sample_sequence(),.completed_sequence(),.pending_frames(pending_frames),.frame_tick(frame_tick));
 apu_frame_scheduler dispatch(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.active_mask(active_mask),.decoder_epoch_begin(decoder_begin),.worker_start_valid(worker_start_valid),.worker_start_ready(worker_start_ready),.worker_slot_valid(worker_slot_valid),.worker_slot_ready(worker_slot_ready),.worker_slot_index(worker_slot_index),.worker_slot_active(worker_slot_active),.worker_frame_valid(worker_frame_valid),.worker_frame_ready(worker_frame_ready),.output_ready(output_ready));
 wire snapshot_change_valid;wire [16:0] snapshot_change_first,snapshot_change_last;
 wire memory_req_valid,read_ready,read_rsp_valid;wire [16:0] memory_req_word_address;
 reg [31:0] memory [0:127];reg stage_valid=0,start_valid=0;
 wire start_ready,publish_valid,store_req_valid,store_req_write,epoch_active;wire [4:0] snapshots_pending,publish_words;wire [16:0] publish_base;
 wire [31:0] read_rsp_word,store_req_wdata;wire [16:0] store_req_addr;reg store_rsp_valid=0;reg [31:0] store_rsp_rdata=0;
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.stage_valid(stage_valid),.stage_index(4'd0),.stage_word(32'h001403e8),.start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),.live_word_address(17'd17),.batch_busy(),.publish_valid(publish_valid),.publish_words(publish_words),.publish_base(publish_base),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),.epoch_begin(frame_tick),.epoch_end(frame_done),.epoch_active(epoch_active),.snapshot_change_valid(snapshot_change_valid),.snapshot_change_first(snapshot_change_first),.snapshot_change_last(snapshot_change_last),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),.snapshots_pending(snapshots_pending),.queued_words(),.epoch_words(),.read_valid(memory_req_valid),.read_ready(read_ready),.read_word_address(memory_req_word_address),.read_rsp_valid(read_rsp_valid),.read_rsp_word(read_rsp_word),.memory_ready(1'b1),.store_req_valid(store_req_valid),.store_req_ready(1'b1),.store_req_write(store_req_write),.store_req_word_address(store_req_addr),.store_req_wdata(store_req_wdata),.store_req_be_n(),.store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_rdata));
 always @(posedge clk) begin
  store_rsp_valid<=reset_n&&store_req_valid;
  if(store_req_valid) begin if(store_req_write) memory[store_req_addr]<=store_req_wdata;else store_rsp_rdata<=memory[store_req_addr];end
 end
 reg bind_valid=0,slot_reset=0;reg [31:0] source_frame=0;wire signed [15:0] left,right;
 apu_badp_mix mixer(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(4'd0),.bind_source_base(19'd0),.bind_source_bytes(20'd4),.bind_data_offset(19'd64),.bind_frames(32'd8),.bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd8),.source_write_valid(publish_valid),.source_write_word(publish_base),.source_write_words(publish_words),.epoch_begin(decoder_begin),.epoch_active(epoch_active),.epoch_change_valid(snapshot_change_valid),.epoch_change_first(snapshot_change_first),.epoch_change_last(snapshot_change_last),.memory_req_valid(memory_req_valid),.memory_req_ready(read_ready),.memory_req_word_address(memory_req_word_address),.memory_rsp_valid(read_rsp_valid),.memory_rsp_word(read_rsp_word),.pcm_memory_req_valid(),.pcm_memory_req_ready(1'b0),.pcm_memory_req_address(),.pcm_memory_rsp_valid(1'b0),.pcm_memory_rsp_word(32'd0),.start_valid(worker_start_valid),.start_ready(worker_start_ready),.slot_valid(worker_slot_valid),.slot_ready(worker_slot_ready),.slot_active(worker_slot_active),.slot_generator_kind(32'd0),.slot_generator_duty_q12(32'd0),.slot_reset(slot_reset),.slot_bits_per_sample(32'd4),.slot_channels(32'd2),.slot_data_address(32'd0),.slot_frame(source_frame),.slot_neighbor(source_frame),.slot_fraction(16'd0),.slot_gain_q12(32'sd4096),.slot_level_lr_q14(32'h40004000),.slot_filter_clear(1'b0),.slot_filter_control(32'd0),.slot_filter_b0_b1(32'd0),.slot_filter_b2_a1(32'd0),.slot_filter_a2(32'd0),.frame_valid(worker_frame_valid),.frame_ready_out(worker_frame_ready),.frame_left(left),.frame_right(right));
 integer i,begins=0,ends=0,slots=0;
 always @(posedge clk)if(reset_n)begin
  if(decoder_begin)begin if(frame_done)$fatal(1,"snapshot popped on admission");begins=begins+1;slots=0;end
  if(worker_slot_valid&&worker_slot_ready)begin if(worker_slot_index!==slots[3:0])$fatal(1,"slot order");slots=slots+1;end
  if(frame_done)begin if(slots!=16)$fatal(1,"incomplete slot frame");ends=ends+1;end
 end
 task automatic accept_output(input [15:0] value);
  begin wait(worker_frame_valid);@(negedge clk);
   if(left!==value||right!==value)$fatal(1,"output expected %h got %h %h",value,left,right);
   repeat(3)begin @(negedge clk);if(!worker_frame_valid||frame_done||left!==value||right!==value)$fatal(1,"output stall");end
   output_ready=1;@(negedge clk);output_ready=0;
  end
 endtask
 initial begin
  for(i=0;i<128;i=i+1)memory[i]=0;
  memory[16]=32'h000c0008;memory[17]=32'h00140064;memory[18]=32'h11111111;
  repeat(2)@(negedge clk);reset_n=1;
  @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  // Three real one-voice frames create a checkpoint for frame 0 and retain
  // frames 1 and 2. Every output traverses all sixteen mixer slots.
  source_frame=0;slot_reset=1;accept_output(16'h0076);
  source_frame=1;slot_reset=0;accept_output(16'h0086);
  source_frame=2;accept_output(16'h0095);
  busy=1;active_mask=0;
  while(!frame_tick)@(negedge clk);@(negedge clk);
  stage_valid=1;@(negedge clk);stage_valid=0;if(!start_ready)$fatal(1,"upload admission");start_valid=1;
  @(negedge clk);start_valid=0;wait(publish_valid);@(negedge clk);
  while(!frame_tick)@(negedge clk);@(negedge clk);
  if(snapshots_pending!=2||snapshot_overflow||snapshot_history_lost)$fatal(1,"queued snapshots");
  busy=0;source_frame=0;
  // Queue A is silent. Its output remains held until accepted; B begins only
  // after A's snapshot is popped and receives its own write provenance.
  wait(worker_frame_valid);@(negedge clk);
  if(left!==0||right!==0)$fatal(1,"empty frame nonzero");
  active_mask=1;accept_output(16'h0000);
  accept_output(16'h03fa);
  @(negedge clk);#1;
  if(snapshots_pending!=0||pending_frames!=0||begins!=5||ends!=5||snapshot_history_lost)$fatal(1,"timeline mismatch %0d %0d",begins,ends);
  $display("PASS real timeline, 16-slot scheduler, upload, BADP, biquad and mixer: retained stale checkpoint, empty frame, changed next snapshot and stalled outputs; RAM/cursors are fixtures");$finish;
 end
 initial begin #2000000;$fatal(1,"timeout");end
endmodule
