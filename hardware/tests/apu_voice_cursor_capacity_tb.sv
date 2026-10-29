`timescale 1ns/1ps
// A representable extreme rate/loop, not a new limit: sixteen active cursors
// traverse the actual scheduler and shared iterative modulo. Mixer consumption
// is ideal and adds no cost. This characterizes a strict counterexample for
// this datapath's unqualified 768-clock frame, not all possible architectures.
module apu_voice_cursor_capacity_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,load_valid=0,frame_valid=0;reg [3:0] load_slot=0;
 wire load_ready,req_valid,req_ready,req_active,rsp_valid,rsp_active,rsp_ended;wire [3:0] req_slot,rsp_slot;
 wire frame_ready,frame_done,start_valid,decoder_begin,worker_frame_ready;reg worker_frame_valid=0;
 apu_frame_scheduler scheduler(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.active_mask(16'hffff),.decoder_epoch_begin(decoder_begin),.worker_start_valid(start_valid),.worker_start_ready(1'b1),.worker_slot_valid(req_valid),.worker_slot_ready(req_ready),.worker_slot_index(req_slot),.worker_slot_active(req_active),.worker_frame_valid(worker_frame_valid),.worker_frame_ready(worker_frame_ready),.output_ready(1'b1));
 apu_voice_cursor cursor(.clk(clk),.reset_n(reset_n),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),.load_cursor_q16(64'sd0),.load_step_q16(64'sh0000be37c63854e4),.load_remainder(32'sd0),.load_step_remainder(32'sh4371),.load_frames(32'hffffffff),.load_loop_start(32'd0),.load_loop_end(32'd1),.req_valid(req_valid),.req_ready(req_ready),.req_slot(req_slot),.req_active(req_active),.rsp_valid(rsp_valid),.rsp_ready(1'b1),.rsp_slot(rsp_slot),.rsp_active(rsp_active),.rsp_ended(rsp_ended),.rsp_frame(),.rsp_neighbor(),.rsp_fraction(),.rsp_next_cursor_q16(),.rsp_next_remainder());
 integer cycles=0,start_cycle=0,n=0,i;
 always @(posedge clk)if(reset_n)begin
  cycles<=cycles+1;
  if(rsp_valid)begin if(!rsp_active||rsp_ended||rsp_slot!==n[3:0])$fatal(1,"incorrect slot %0d",n);n<=n+1;if(n==15)worker_frame_valid<=1;end
 end
 initial begin repeat(2)@(negedge clk);reset_n=1;
 for(i=0;i<16;i=i+1)begin @(negedge clk);load_slot=i;while(!load_ready)@(negedge clk);load_valid=1;@(negedge clk);load_valid=0;end
 @(negedge clk);frame_valid=1;start_cycle=cycles;@(negedge clk);frame_valid=0;
 wait(frame_done);@(negedge clk);
 if(cycles-start_cycle<=768||n!=16)$fatal(1,"expected over-budget extreme workload");
 $display("CHARACTERIZED LIMIT: 16 active extreme loop cursors required %0d clocks with ideal mixer, >768; no samples dropped or rate clamped",cycles-start_cycle);$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
