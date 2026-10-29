`timescale 1ns/1ps
// Frame playback owner for the existing ordered scheduler, per-voice cursor
// and PCM/BADP mixer. The slot bank supplies the retained raw words for
// fetch_slot. The caller serializes command/live updates with frame admission,
// and captures a sample-memory snapshot at each actual timeline edge.
//
// Cursor loads are admitted only between frame work and with authorization
// from the timeline/reservation owner. The owner prevents an unreserved load
// on an incoming frame tick but keeps an earlier command's authorization
// through its busy period; timeline_ready alone cannot supply both rules.
// Decoder/filter-clear requests are retained per voice until the
// next active descriptor has actually been accepted. Natural endings are
// retained until the output has been accepted, then reported in slot order;
// each accepted end must atomically clear that slot and publish SLOT_ENDED.
// Frame completion waits for those actions. The event/slot action owner is
// external, not a hidden reset, rollback, or substitute sample.
//
// The binder, arithmetic rate resolver, live-source coordinator,
// gain/fade owner, MMIO, external ROM selection, and memory-snapshot owner
// remain separate; this is not a complete APU or a deadline guarantee.
module apu_playback_frame (
 input wire clk,reset_n,
 input wire frame_valid,output wire frame_ready,output wire frame_done,
 input wire [15:0] render_mask,
 output wire [3:0] fetch_slot,input wire [671:0] fetch_parameters,
 input wire load_valid,input wire load_authorized,output wire load_ready,input wire [3:0] load_slot,
 input wire signed [63:0] load_cursor_q16,load_step_q16,
 input wire signed [31:0] load_remainder,load_step_remainder,
 input wire [31:0] load_frames,load_loop_start,load_loop_end,
 input wire load_decoder_reset,load_filter_clear,
 input wire bind_valid,input wire [3:0] bind_voice,
 input wire [18:0] bind_source_base,input wire [19:0] bind_source_bytes,
 input wire [18:0] bind_data_offset,input wire [31:0] bind_frames,
 input wire [1:0] bind_channels,input wire [18:0] bind_seek_base,
 input wire [31:0] bind_seek_count,bind_loop_start,bind_loop_end,
 input wire source_write_valid,input wire [16:0] source_write_word,input wire [4:0] source_write_words,
 input wire epoch_active,epoch_change_valid,input wire [16:0] epoch_change_first,epoch_change_last,
 output wire decoder_epoch_begin,
 output wire memory_req_valid,input wire memory_req_ready,output wire [16:0] memory_req_word_address,
 input wire memory_rsp_valid,input wire [31:0] memory_rsp_word,
 output wire pcm_memory_req_valid,input wire pcm_memory_req_ready,output wire [31:0] pcm_memory_req_address,
 input wire pcm_memory_rsp_valid,input wire [31:0] pcm_memory_rsp_word,
 output wire output_valid,input wire output_ready,output wire signed [15:0] output_left,output_right,
 output wire end_valid,input wire end_ready,output reg [3:0] end_slot,
 output wire busy
);
 wire start_valid,start_ready,dispatch_valid,dispatch_ready,dispatch_active;
 wire [3:0] dispatch_slot;
 wire mixer_frame_valid,mixer_frame_ready;
 reg frame_busy,output_consumed;
 reg [15:0] decoder_reset_pending,filter_clear_pending,ended;
 wire cursor_valid,cursor_ready,cursor_active,cursor_ended;
 wire [3:0] cursor_slot;wire [31:0] cursor_frame,cursor_neighbor;wire [15:0] cursor_fraction;
 wire cursor_load_ready;
 assign fetch_slot=cursor_slot;
 assign load_ready=reset_n && load_authorized && !frame_busy && !frame_valid && cursor_load_ready;
 wire load_accept=load_valid && load_ready;
 wire cursor_accept=cursor_valid && cursor_ready;
 wire output_accept=output_valid && output_ready;
 wire end_accept=end_valid && end_ready;
 assign busy=frame_busy;
 assign output_valid=reset_n && mixer_frame_valid && !output_consumed;
 assign end_valid=reset_n && mixer_frame_valid && output_consumed && ended!=0;
 integer i;
 always @* begin
  end_slot=0;
  for(integer k=15;k>=0;k=k-1) if(ended[k]) end_slot=k;
 end
 apu_frame_scheduler scheduler(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .active_mask(render_mask),.decoder_epoch_begin(decoder_epoch_begin),.worker_start_valid(start_valid),.worker_start_ready(start_ready),
  .worker_slot_valid(dispatch_valid),.worker_slot_ready(dispatch_ready),.worker_slot_index(dispatch_slot),.worker_slot_active(dispatch_active),
  .worker_frame_valid(mixer_frame_valid),.worker_frame_ready(mixer_frame_ready),.output_ready(output_consumed && ended==0));
 apu_voice_cursor_lanes cursor(.clk(clk),.reset_n(reset_n),.load_valid(load_accept),.load_ready(cursor_load_ready),.load_slot(load_slot),
  .load_cursor_q16(load_cursor_q16),.load_step_q16(load_step_q16),.load_remainder(load_remainder),.load_step_remainder(load_step_remainder),
  .load_frames(load_frames),.load_loop_start(load_loop_start),.load_loop_end(load_loop_end),
  .req_valid(dispatch_valid),.req_ready(dispatch_ready),.req_slot(dispatch_slot),.req_active(dispatch_active),
  .rsp_valid(cursor_valid),.rsp_ready(cursor_ready),.rsp_slot(cursor_slot),.rsp_active(cursor_active),.rsp_ended(cursor_ended),
  .rsp_frame(cursor_frame),.rsp_neighbor(cursor_neighbor),.rsp_fraction(cursor_fraction),.rsp_next_cursor_q16(),.rsp_next_remainder());
 apu_badp_mix mixer(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(bind_voice),
  .bind_source_base(bind_source_base),.bind_source_bytes(bind_source_bytes),.bind_data_offset(bind_data_offset),
  .bind_frames(bind_frames),.bind_channels(bind_channels),.bind_seek_base(bind_seek_base),.bind_seek_count(bind_seek_count),
  .bind_loop_start(bind_loop_start),.bind_loop_end(bind_loop_end),.source_write_valid(source_write_valid),
  .source_write_word(source_write_word),.source_write_words(source_write_words),.epoch_begin(decoder_epoch_begin),.epoch_active(epoch_active),
  .epoch_change_valid(epoch_change_valid),.epoch_change_first(epoch_change_first),.epoch_change_last(epoch_change_last),
  .memory_req_valid(memory_req_valid),.memory_req_ready(memory_req_ready),.memory_req_word_address(memory_req_word_address),
  .memory_rsp_valid(memory_rsp_valid),.memory_rsp_word(memory_rsp_word),.pcm_memory_req_valid(pcm_memory_req_valid),
  .pcm_memory_req_ready(pcm_memory_req_ready),.pcm_memory_req_address(pcm_memory_req_address),
  .pcm_memory_rsp_valid(pcm_memory_rsp_valid),.pcm_memory_rsp_word(pcm_memory_rsp_word),
  .start_valid(start_valid),.start_ready(start_ready),.slot_valid(cursor_valid),.slot_ready(cursor_ready),.slot_active(cursor_active),
  .slot_reset(decoder_reset_pending[cursor_slot]),.slot_filter_clear(filter_clear_pending[cursor_slot]),
  .slot_frame(cursor_frame),.slot_neighbor(cursor_neighbor),.slot_fraction(cursor_fraction),
  .slot_bits_per_sample(fetch_parameters[4*32+:32]),.slot_channels(fetch_parameters[3*32+:32]),
  .slot_data_address(fetch_parameters[0+:32]+fetch_parameters[6*32+:32]),
  .slot_generator_kind(fetch_parameters[19*32+:32]),.slot_generator_duty_q12(fetch_parameters[20*32+:32]),
  .slot_gain_q12(fetch_parameters[12*32+:32]),.slot_level_lr_q14(32'h40004000),
  .slot_filter_control(fetch_parameters[14*32+:32]),.slot_filter_b0_b1(fetch_parameters[15*32+:32]),
  .slot_filter_b2_a1(fetch_parameters[16*32+:32]),.slot_filter_a2(fetch_parameters[17*32+:32]),
  .frame_valid(mixer_frame_valid),.frame_ready_out(mixer_frame_ready),.frame_left(output_left),.frame_right(output_right));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin frame_busy<=0;output_consumed<=0;decoder_reset_pending<=0;filter_clear_pending<=0;ended<=0;end
  else begin
   if(frame_valid && frame_ready) begin frame_busy<=1;output_consumed<=0;ended<=0;end
   if(load_accept) begin
    decoder_reset_pending[load_slot]<=decoder_reset_pending[load_slot] | load_decoder_reset;
    filter_clear_pending[load_slot]<=filter_clear_pending[load_slot] | load_filter_clear;
   end
   if(cursor_accept) begin
    if(cursor_active) begin decoder_reset_pending[cursor_slot]<=0;filter_clear_pending[cursor_slot]<=0;end
    if(cursor_ended) ended[cursor_slot]<=1;
   end
   if(output_accept) output_consumed<=1;
   if(end_accept) ended[end_slot]<=0;
   if(frame_done) begin frame_busy<=0;output_consumed<=0;end
  end
 end
endmodule
