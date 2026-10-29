`timescale 1ns/1ps
// Real slot bank, live update, frame timeline, dispatcher and PCM mixer. The
// source binder, playback cursor and SRAM words are controlled test owners;
// this is not a complete APU or a cartridge-size decision.
module apu_live_frame_order_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 wire timeline_ready,frame_valid,frame_ready,frame_done,frame_tick;
 wire [63:0] pending_frames;wire live_busy;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.executor_busy(live_busy),
  .snapshot_overflow(1'b0),.snapshot_history_lost(),.timeline_ready(timeline_ready),
  .frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .sample_sequence(),.completed_sequence(),.pending_frames(pending_frames),.frame_tick(frame_tick));
 reg access_valid=0,access_write=0;reg [4:0] access_index=0;reg [31:0] access_wdata=0;
 reg commit_valid=0;reg [1:0] commit_action=0;reg [2:0] commit_phase=0;reg [671:0] commit_parameters=0;
 wire access_ready,response_valid,commit_ready,update_valid,update_ready;
 wire [31:0] response_data,update_word;wire [3:0] update_slot;wire [4:0] update_index;
 wire [671:0] update_parameters,fetch_parameters;
 wire rebind_valid,rebind_cartridge;wire [3:0] rebind_slot;
 wire [15:0] active_mask,render_mask;wire [2:0] selected_phase;
 wire worker_slot_valid,worker_slot_ready,worker_slot_active,worker_start_valid,worker_start_ready;
 wire worker_frame_valid,worker_frame_ready,decoder_epoch;wire [3:0] worker_slot_index;
 reg output_ready=0;
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(4'd0),
  .access_valid(access_valid),.access_write(access_write),.access_index(access_index),.access_wdata(access_wdata),
  .timeline_ready(timeline_ready),.access_ready(access_ready),.response_valid(response_valid),.response_data(response_data),
  .commit_valid(commit_valid),.commit_ready(commit_ready),.commit_action(commit_action),.commit_slot(4'd0),
  .commit_parameters(commit_parameters),.commit_phase(commit_phase),.commit_index(5'd0),.commit_word(32'd0),.commit_cartridge(1'b0),
  .rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fetch_slot(worker_slot_index),.fetch_active(),.fetch_cartridge(),.fetch_parameters(fetch_parameters),.event_slot(4'd0),.event_source_address(),.render_mask(render_mask),
  .update_valid(update_valid),.update_ready(update_ready),.update_slot(update_slot),.update_index(update_index),
  .update_word(update_word),.update_parameters(update_parameters),.selected_phase(selected_phase),.selected_active(),
  .selected_source_address(),.active_mask(active_mask));
 wire bind_valid,bind_rsp_ready,action_valid,action_success,action_source_replace;wire [671:0] bind_parameters;
 reg bind_ready=0,bind_rsp_valid=0;
 apu_live_source_update update(.clk(clk),.reset_n(reset_n),.update_valid(update_valid),.update_ready(update_ready),
  .update_slot(update_slot),.update_index(update_index),.update_word(update_word),.update_parameters(update_parameters),
  .selected_cartridge(1'b0),.busy(live_busy),.bind_valid(bind_valid),.bind_ready(bind_ready),.bind_parameters(bind_parameters),
  .bind_cartridge(),.bind_rsp_valid(bind_rsp_valid),.bind_rsp_ready(bind_rsp_ready),.bind_rsp_ok(1'b1),
  .action_valid(action_valid),.action_ready(1'b1),.action_success(action_success),.action_source_replace(action_source_replace),
  .action_slot(),.action_index(),.action_word(),.action_parameters(),.action_cartridge(),
  .rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fault_valid(),.fault_ready(1'b1),.fault_code(),.fault_detail());
 apu_frame_scheduler schedule(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .active_mask(render_mask),.decoder_epoch_begin(decoder_epoch),.worker_start_valid(worker_start_valid),.worker_start_ready(worker_start_ready),
  .worker_slot_valid(worker_slot_valid),.worker_slot_ready(worker_slot_ready),.worker_slot_index(worker_slot_index),.worker_slot_active(worker_slot_active),
  .worker_frame_valid(worker_frame_valid),.worker_frame_ready(worker_frame_ready),.output_ready(output_ready));
 wire pcm_read;wire [31:0] pcm_addr;reg pcm_rsp=0;reg [31:0] pcm_word=0;
 reg [31:0] memory[0:3];
 always @(posedge clk) begin
  pcm_rsp<=reset_n && pcm_read;
  if(pcm_read) begin
   if(pcm_addr<32'h40000000 || pcm_addr>=32'h40000010)$fatal(1,"fixture source address %h",pcm_addr);
   pcm_word<=memory[(pcm_addr-32'h40000000)>>2];
  end
 end
 wire signed [15:0] left,right;
 apu_badp_mix mixer(.clk(clk),.reset_n(reset_n),.bind_valid(1'b0),.bind_voice(4'd0),.bind_source_base(19'd0),
  .bind_source_bytes(20'd0),.bind_data_offset(19'd0),.bind_frames(32'd0),.bind_channels(2'd0),.bind_seek_base(19'd0),
  .bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd0),.source_write_valid(1'b0),.source_write_word(17'd0),
  .source_write_words(5'd0),.epoch_begin(decoder_epoch),.epoch_active(1'b0),.epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),
  .memory_req_valid(),.memory_req_ready(1'b0),.memory_req_word_address(),.memory_rsp_valid(1'b0),.memory_rsp_word(32'd0),
  .pcm_memory_req_valid(pcm_read),.pcm_memory_req_ready(1'b1),.pcm_memory_req_address(pcm_addr),.pcm_memory_rsp_valid(pcm_rsp),.pcm_memory_rsp_word(pcm_word),
  .start_valid(worker_start_valid),.start_ready(worker_start_ready),.slot_valid(worker_slot_valid),.slot_ready(worker_slot_ready),.slot_active(worker_slot_active),.slot_generator_kind(32'd0),.slot_generator_duty_q12(32'd0),
  .slot_reset(1'b0),.slot_frame(32'd0),.slot_neighbor(32'd0),.slot_fraction(16'd0),
  .slot_bits_per_sample(fetch_parameters[4*32+:32]),.slot_channels(fetch_parameters[3*32+:32]),
  .slot_data_address(fetch_parameters[0+:32]+fetch_parameters[6*32+:32]),.slot_gain_q12(fetch_parameters[12*32+:32]),
  .slot_level_lr_q14(32'h40004000),.slot_filter_clear(1'b0),.slot_filter_control(32'd0),.slot_filter_b0_b1(32'd0),.slot_filter_b2_a1(32'd0),.slot_filter_a2(32'd0),
  .frame_valid(worker_frame_valid),.frame_ready_out(worker_frame_ready),.frame_left(left),.frame_right(right));
 task automatic finish_frame(input [15:0] expected);
  begin wait(worker_frame_valid);@(negedge clk);
   if(left!==expected || right!==expected)$fatal(1,"frame %h/%h expected %h",left,right,expected);
   repeat(3)begin @(negedge clk);if(!worker_frame_valid || frame_done || left!==expected || right!==expected)$fatal(1,"frame hold");end
   output_ready=1;@(negedge clk);output_ready=0;
  end
 endtask
 task automatic change_phase(input [2:0] phase);
  begin wait(timeline_ready);@(negedge clk);commit_action=2;commit_phase=phase;commit_valid=1;
   @(negedge clk);commit_valid=0;end
 endtask
 initial begin
  memory[0]=32'd1000;memory[1]=32'd3000;memory[2]=0;memory[3]=0;
  repeat(2)@(negedge clk);reset_n=1;
  commit_parameters[0+:32]=32'h40000000;commit_parameters[1*32+:32]=16;
  commit_parameters[3*32+:32]=1;commit_parameters[4*32+:32]=16;commit_parameters[12*32+:32]=4096;
  @(negedge clk);commit_valid=1;commit_action=0;@(negedge clk);commit_valid=0;
  if(active_mask!==1 || render_mask!==1)$fatal(1,"install");
  // A selected-slot write offered on an output edge cannot overtake that frame.
  wait(frame_tick);@(negedge clk);access_valid=1;access_write=1;access_index=6;access_wdata=4;
  #1;if(access_ready)$fatal(1,"frame lost priority on edge");
  wait(worker_frame_valid);#1;if(access_ready)$fatal(1,"frame output was not retired");
  finish_frame(16'd1000);
  wait(access_ready);@(negedge clk);access_valid=0;access_write=0;
  wait(bind_valid);#1;if(!live_busy || bind_parameters[6*32+:32]!==4)$fatal(1,"raw live write missing");
  // Keep the bind pending across a second edge: the timeline retains frame debt
  // and the mixer cannot observe the newly written source before acceptance.
  wait(frame_tick);@(posedge clk);@(negedge clk);#1;if(frame_valid || !live_busy || pending_frames!==1)$fatal(1,"pending bind allowed frame, pending=%0d valid=%b busy=%b",pending_frames,frame_valid,live_busy);
  bind_ready=1;@(negedge clk);bind_ready=0;wait(bind_rsp_ready);
  @(negedge clk);bind_rsp_valid=1;@(negedge clk);bind_rsp_valid=0;
  wait(action_valid);#1;if(!action_success || !action_source_replace)$fatal(1,"live source action");
  wait(!live_busy);finish_frame(16'd3000);
  // Paused voices remain publicly active, but must not be rendered.
  change_phase(3'd5);#1;if(active_mask!==1 || render_mask!==0 || selected_phase!==5)$fatal(1,"paused render mask");
  finish_frame(16'd0);change_phase(3'd1);
  #1;if(active_mask!==1 || render_mask!==1)$fatal(1,"resumed render mask");
  finish_frame(16'd3000);
  $display("PASS real slot/live/timeline/scheduler/PCM mixer: frame-before-write, bind debt, paused silence and resume; binder/cursor/RAM are fixtures");$finish;
 end
 initial begin #200000;$fatal(1,"watchdog");end
endmodule
