`timescale 1ns/1ps
// Real timeline, playback/cursor/mixer and PCM1754 serializer. The test
// supplies one square descriptor and cursor load; it is not a complete APU.
module apu_serial_playback_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,executor_busy=0,load_valid=0;
 reg [671:0] parameters=0;
 wire frame_tick,frame_valid,frame_ready,frame_done,timeline_ready,history_lost;
 wire [63:0] pending_frames;
 wire output_valid,output_ready,frame_latch,deadline_missed,mclk,bclk,lrck,serial_data;
 wire signed [15:0] left,right;
 wire load_ready,badp_req,pcm_req;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.executor_busy(executor_busy),
  .snapshot_overflow(1'b0),.snapshot_history_lost(history_lost),.timeline_ready(timeline_ready),.capture_ready(),
  .frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.sample_sequence(),.completed_sequence(),
  .pending_frames(pending_frames),.frame_tick(frame_tick));
 apu_playback_frame playback(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .render_mask(16'h0001),.fetch_slot(),.fetch_parameters(parameters),.load_valid(load_valid),.load_authorized(1'b1),.load_ready(load_ready),
  .load_slot(4'd0),.load_cursor_q16(64'sd0),.load_step_q16(64'sd32768),.load_remainder(32'sd0),.load_step_remainder(32'sd0),
  .load_frames(32'd1),.load_loop_start(32'd0),.load_loop_end(32'd1),.load_decoder_reset(1'b0),.load_filter_clear(1'b0),
  .bind_valid(1'b0),.bind_voice(4'd0),.bind_source_base(19'd0),.bind_source_bytes(20'd0),.bind_data_offset(19'd0),.bind_frames(32'd0),
  .bind_channels(2'd0),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd0),
  .source_write_valid(1'b0),.source_write_word(17'd0),.source_write_words(5'd0),.epoch_active(1'b0),.epoch_change_valid(1'b0),
  .epoch_change_first(17'd0),.epoch_change_last(17'd0),.decoder_epoch_begin(),
  .memory_req_valid(badp_req),.memory_req_ready(1'b0),.memory_req_word_address(),.memory_rsp_valid(1'b0),.memory_rsp_word(32'd0),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(1'b0),.pcm_memory_req_address(),.pcm_memory_rsp_valid(1'b0),.pcm_memory_rsp_word(32'd0),
  .output_valid(output_valid),.output_ready(output_ready),.output_left(left),.output_right(right),
  .end_valid(),.end_ready(1'b0),.end_slot(),.busy());
 apu_serial_output output_path(.clk(clk),.reset_n(reset_n),.frame_valid(output_valid),.frame_ready(output_ready),
  .frame_left(left),.frame_right(right),.frame_latch(frame_latch),.deadline_missed(deadline_missed),
  .mclk(mclk),.bclk(bclk),.lrck(lrck),.serial_data(serial_data));
 integer ticks=0,accepted=0,produced=0,completed=0,ready_between=0,checked_bits=0,bit_index=0;
 reg checking=0,expected_bit,was_held=0;
 reg [31:0] expected_frame,source_expected,held_frame;
 always @(posedge clk) if(reset_n) begin
  if(frame_tick!==frame_latch)$fatal(1,"timeline and serializer phase differ");
  if(badp_req || pcm_req || history_lost)$fatal(1,"unexpected square memory or snapshot error");
  if(output_valid && !output_ready) begin
   if(was_held && held_frame!=={right,left})$fatal(1,"playback output changed under serial backpressure");
   held_frame={right,left};was_held=1;
  end else was_held=0;
  if(output_valid && output_ready) begin
   source_expected=(produced%2)==0 ? 32'h7fff7fff : 32'h80008000;
   if({right,left}!==source_expected)$fatal(1,"produced sample %0d got %h expected %h",produced,{right,left},source_expected);
   produced=produced+1;
  end
  if(frame_done)completed=completed+1;
  if(timeline_ready && ticks>0 && produced>=ticks && completed>=ticks)ready_between=ready_between+1;
  if(frame_latch) begin
   ticks=ticks+1;
   if(ticks==1 && output_valid)$fatal(1,"startup produced a frame before its input tick");
   if(ticks>1 && ticks<=5) begin
    if(produced<ticks-1 || completed<ticks-1 || deadline_missed)$fatal(1,"frame missed deadline or control remained blocked at tick %0d",ticks);
    expected_frame=(accepted%2)==0 ? 32'h7fff7fff : 32'h80008000;
    if(checking)$fatal(1,"previous serial frame incomplete");
    bit_index=0;checking=1;accepted=accepted+1;
   end
  end
 end
 always @(posedge bclk) if(reset_n && checking) begin
  if(lrck!==(bit_index>=32))$fatal(1,"LRCK mismatch at bit %0d",bit_index);
  expected_bit=0;
  if(bit_index>=1 && bit_index<=16)expected_bit=expected_frame[16-bit_index];
  if(bit_index>=33 && bit_index<=48)expected_bit=expected_frame[48-bit_index+16];
  if(serial_data!==expected_bit)$fatal(1,"I2S data mismatch at bit %0d",bit_index);
  checked_bits=checked_bits+1;bit_index=bit_index+1;
  if(bit_index==64)checking=0;
 end
 initial begin
  parameters[3*32+:32]=1;parameters[4*32+:32]=16;parameters[5*32+:32]=1;
  parameters[12*32+:32]=4096;parameters[19*32+:32]=1;parameters[20*32+:32]=2048;
  repeat(3)@(negedge clk);reset_n=1;
  while(!load_ready)@(negedge clk);load_valid=1;@(negedge clk);load_valid=0;
  wait(accepted==4);wait(!checking);@(negedge clk);
  if(checked_bits!=256 || ready_between<4 || deadline_missed)$fatal(1,"normal stream incomplete or control never became ready between edges");
  // Block production past the next two real frame edges. The diagnostic must
  // reveal a missed deadline; no recovered audio behavior is asserted.
  executor_busy=1;
  wait(deadline_missed);@(negedge clk);
  if(pending_frames==0)$fatal(1,"miss without pending frame");
  reset_n=0;@(negedge clk);
  if(deadline_missed)$fatal(1,"reset did not clear deadline diagnostic");
  $display("PASS playback -> buffered PCM1754 I2S: 4 stereo frames, 256 serial bits, early frame completion/control access and explicit stalled-producer miss");
  $finish;
 end
 initial begin #200000;$fatal(1,"serial playback watchdog");end
endmodule
