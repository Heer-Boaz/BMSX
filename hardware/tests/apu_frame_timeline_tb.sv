`timescale 1ns/1ps
// Real ingress, executor and slot bank around the timeline. The controllable
// frame and playback owners are test counterparts, not a DAC or source binder.
module apu_frame_timeline_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0, allow_service=0, access_valid=0, access_write=0;
 reg [4:0] access_index=0; reg [31:0] access_wdata=0;
 wire access_ready, ingress_rsp; wire [31:0] ingress_data;
 wire fault_raise; wire [31:0] fault_detail_unused;
 wire [3:0] selected_slot; wire [4:0] count;
 wire command_valid,command_consume; wire [31:0] command_word;
 wire [671:0] command_parameters;
 wire timeline_ready,frame_valid,frame_tick; reg frame_ready=0,frame_done=0;
 wire [31:0] sample_sequence,completed_sequence; wire [63:0] pending_frames;
 wire busy,reservation_valid; wire [3:0] query_slot;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.snapshot_overflow(1'b0),.snapshot_history_lost(),.executor_busy(busy),
  .timeline_ready(timeline_ready),.frame_valid(frame_valid),.frame_ready(frame_ready),
  .frame_done(frame_done),.sample_sequence(sample_sequence),.completed_sequence(completed_sequence),
  .pending_frames(pending_frames),.frame_tick(frame_tick));
 apu_command_ingress ingress(.clk(clk),.reset_n(reset_n),.access_valid(access_valid),
  .access_write(access_write),.access_index(access_index),.access_wdata(access_wdata),
  .timeline_ready(timeline_ready),.access_ready(access_ready),.response_valid(ingress_rsp),
  .response_data(ingress_data),.fault_raise(fault_raise),.fault_detail(fault_detail_unused),
  .selected_slot(selected_slot),.queued_count(count),.command_valid(command_valid),
  .command_consume(command_consume),.command_word(command_word),.command_parameters(command_parameters));
 wire bind_valid,bind_rsp_ready,bind_cartridge;
 wire [671:0] bind_parameters;
 wire action_valid,action_ready; reg playback_ready=0;
 wire [1:0] action_bank_op; wire [31:0] action_command,action_word;
 wire [3:0] action_slot; wire [671:0] action_parameters;
 wire [2:0] action_phase; wire [4:0] action_index; wire action_cartridge;
 wire fault_valid; wire [31:0] fault_code,fault_detail;
 wire commit_ready; wire [2:0] selected_phase; wire selected_active;
 wire [15:0] active_mask; wire [31:0] selected_source_address;
 wire update_valid; wire [3:0] update_slot; wire [4:0] update_index;
 wire [31:0] update_word; wire [671:0] update_parameters;
 wire bank_access_ready,bank_rsp; wire [31:0] bank_data;
 apu_command_executor executor(.clk(clk),.reset_n(reset_n),.service_ready(timeline_ready && allow_service),
  .command_valid(command_valid),.command_consume(command_consume),.command_word(command_word),
  .command_parameters(command_parameters),.selected_cartridge(1'b0),.busy(busy),
  .reservation_valid(reservation_valid),.query_slot(query_slot),.slot_phase(selected_phase),
  .bind_valid(bind_valid),.bind_ready(1'b0),.bind_parameters(bind_parameters),.bind_cartridge(bind_cartridge),
  .bind_rsp_valid(1'b0),.bind_rsp_ready(bind_rsp_ready),.bind_rsp_ok(1'b0),
  .action_valid(action_valid),.action_ready(action_ready),.action_bank_op(action_bank_op),
  .action_command(action_command),.action_slot(action_slot),.action_parameters(action_parameters),
  .action_phase(action_phase),.action_index(action_index),.action_word(action_word),
  .action_cartridge(action_cartridge),.fault_valid(fault_valid),.fault_ready(1'b1),
  .fault_code(fault_code),.fault_detail(fault_detail));
 assign action_ready=commit_ready && playback_ready;
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(query_slot),
  .access_valid(1'b0),.access_write(1'b0),.access_index(5'd0),.access_wdata(32'd0),
  .timeline_ready(timeline_ready && !reservation_valid),.access_ready(bank_access_ready),
  .response_valid(bank_rsp),.response_data(bank_data),.commit_valid(action_valid && playback_ready),
  .commit_ready(commit_ready),.commit_action(action_bank_op),.commit_slot(action_slot),
  .commit_parameters(action_parameters),.commit_phase(action_phase),.commit_index(action_index),
  .commit_word(action_word),.commit_cartridge(action_cartridge),
  .rebind_valid(1'b0),.rebind_slot(4'd0),.rebind_cartridge(1'b0),.fetch_slot(4'd0),.fetch_active(),.fetch_cartridge(),.event_slot(4'd0),.event_source_address(),
  .update_valid(update_valid),.update_ready(1'b1),
  .update_slot(update_slot),.update_index(update_index),.update_word(update_word),
  .update_parameters(update_parameters),.selected_phase(selected_phase),.selected_active(selected_active),
  .selected_source_address(selected_source_address),.active_mask(active_mask));
 task automatic write_reg(input [4:0] idx,input [31:0] val);
  begin @(negedge clk);access_valid=1;access_write=1;access_index=idx;access_wdata=val;
   @(negedge clk);if(!ingress_rsp)$fatal(1,"ingress did not accept");access_valid=0;access_write=0;end
 endtask
 task automatic accept_frame(input [15:0] expected_mask);
  begin wait(frame_valid);@(negedge clk);frame_ready=1;#1;
   if(active_mask!==expected_mask || !frame_valid)$fatal(1,"frame saw wrong slot state");
   @(negedge clk);frame_ready=0;
   if(timeline_ready || frame_valid)$fatal(1,"in-flight frame did not hold boundary");
   repeat(3) @(negedge clk);frame_done=1;
   @(negedge clk);frame_done=0;
  end
 endtask
 integer ticks=0; integer last_tick=0; integer cycles=0;
 always @(posedge clk) if(reset_n) begin
  cycles=cycles+1;
  if(frame_tick) begin
   if(cycles-last_tick!=768)$fatal(1,"incorrect cadence");
   ticks=ticks+1;last_tick=cycles;
  end
 end
 initial begin
  repeat(2) @(negedge clk);reset_n=1;
  write_reg(10,3);write_reg(19,1);write_reg(21,1);
  if(count!==1)$fatal(1,"no queued PLAY");
  wait(frame_tick);@(negedge clk);allow_service=1;#1;
  if(timeline_ready || command_consume)$fatal(1,"frame edge lost priority");
  wait(frame_valid);repeat(4) begin @(negedge clk);
   if(!frame_valid || command_consume || timeline_ready)$fatal(1,"unaccepted frame not retained");end
  accept_frame(16'd0);
  wait(command_consume);@(negedge clk);wait(action_valid);
  if(sample_sequence!==1 || active_mask!==0)$fatal(1,"first frame/PLAY order");
  // A withheld PLAY crosses two real deadlines. Record both without letting
  // later frames pass it. No inference about achievable output timing.
  wait(ticks==3);@(negedge clk);#1;
  if(pending_frames!==2 || sample_sequence!==3 || completed_sequence!==1 || frame_valid || timeline_ready || !busy)
   $fatal(1,"command reservation lost frame debt");
  playback_ready=1;@(negedge clk);playback_ready=0;wait(!busy);
  if(active_mask!==16'h0008)$fatal(1,"PLAY action missing");
  allow_service=0;accept_frame(16'h0008);accept_frame(16'h0008);
  @(negedge clk);#1;
  if(sample_sequence!==3 || pending_frames!==0 || !timeline_ready)$fatal(1,"frame debt not drained");
  // A single frame itself takes longer than one output period. The following
  // edge is counted while the first frame is in flight, not dropped or issued
  // to the frame owner a second time.
  wait(frame_valid);@(negedge clk);frame_ready=1;@(negedge clk);frame_ready=0;
  wait(ticks==5);@(negedge clk);#1;
  if(pending_frames!==2 || frame_valid || timeline_ready || sample_sequence!==5 || completed_sequence!==3)
   $fatal(1,"frame-in-flight deadline debt lost");
  frame_done=1;@(negedge clk);frame_done=0;
  accept_frame(16'h0008);@(negedge clk);#1;
  if(sample_sequence!==5 || pending_frames!==0)$fatal(1,"long-frame debt not drained");
  // Completion coinciding with the next tick completes the old frame and
  // creates exactly one new frame; the command boundary stays closed.
  wait(frame_valid);@(negedge clk);frame_ready=1;@(negedge clk);frame_ready=0;
  wait(frame_tick);@(negedge clk);frame_done=1;
  @(negedge clk);frame_done=0;#1;
  if(sample_sequence!==7 || completed_sequence!==6 || pending_frames!==1 || timeline_ready)
   $fatal(1,"simultaneous completion/tick ordering");
  accept_frame(16'h0008);@(negedge clk);#1;
  if(sample_sequence!==7 || completed_sequence!==7 || pending_frames!==0)
   $fatal(1,"simultaneous completion/tick debt not drained");
  // An empty or combinational frame owner may finish on its admission edge.
  wait(frame_valid);@(negedge clk);frame_ready=1;frame_done=1;
  @(negedge clk);frame_ready=0;frame_done=0;#1;
  if(sample_sequence!==8 || completed_sequence!==8 || pending_frames!==0 || !timeline_ready)
   $fatal(1,"same-edge frame admission/completion lost");
  $display("PASS fixed 768-clock frame cadence, edge priority, stalled command, retained frame debt, real ingress/executor/slot bank; synthetic playback");
  $finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
