`timescale 1ns/1ps
// Integration regression for the actual 768-clock timeline and upload owner:
// a full fence bank retires and captures while a batch becomes due. A minimal
// immediate-ACK store is used; no decoder or physical SRAM pins are exercised.
module apu_frame_snapshot_edge_tb;
reg clk=0;always #5 clk=~clk;reg reset_n=0,busy=1,frame_ready=0,frame_done=0;
wire frame_tick,frame_valid,snapshot_overflow,snapshot_history_lost;wire [63:0] pending_frames;wire [4:0] snapshots_pending;
apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.executor_busy(busy),.snapshot_overflow(snapshot_overflow),.snapshot_history_lost(snapshot_history_lost),.timeline_ready(),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.sample_sequence(),.completed_sequence(),.pending_frames(pending_frames),.frame_tick(frame_tick));
reg stage_valid=0,start_valid=0; wire start_ready,batch_busy,publish_valid,snapshot_ready,epoch_active,store_req_valid,store_req_write;wire [16:0] snapshot_change_first,snapshot_change_last; wire snapshot_change_valid;reg store_rsp_valid=0;
apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.stage_valid(stage_valid),.stage_index(4'd0),.stage_word(32'h12345678),.start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),.live_word_address(17'd17),.batch_busy(batch_busy),.publish_valid(publish_valid),.publish_words(),.publish_base(),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),.epoch_begin(frame_tick),.epoch_end(frame_done),.epoch_active(epoch_active),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),.snapshots_pending(snapshots_pending),.snapshot_change_valid(snapshot_change_valid),.snapshot_change_first(snapshot_change_first),.snapshot_change_last(snapshot_change_last),.queued_words(),.epoch_words(),.read_valid(1'b0),.read_ready(),.read_word_address(17'd0),.read_rsp_valid(),.read_rsp_word(),.memory_ready(1'b1),.store_req_valid(store_req_valid),.store_req_ready(1'b1),.store_req_write(store_req_write),.store_req_word_address(),.store_req_wdata(),.store_req_be_n(),.store_rsp_valid(store_rsp_valid),.store_rsp_rdata(32'd0));
always @(posedge clk) store_rsp_valid<=store_req_valid;
integer i;
initial begin repeat(2)@(negedge clk);reset_n=1;
for(i=0;i<16;i=i+1)begin while(!frame_tick)@(negedge clk);@(negedge clk);end
if(snapshots_pending!=16 || pending_frames!=16)$fatal(1,"initial full snapshot mismatch");
busy=0;frame_ready=1;@(negedge clk);frame_ready=0;
while(timeline.phase!=733)@(negedge clk);stage_valid=1;@(negedge clk);stage_valid=0;
while(timeline.phase!=735)@(negedge clk);if(!start_ready)$fatal(1,"start");start_valid=1;@(negedge clk);start_valid=0;
while(!frame_tick)@(negedge clk);frame_done=1;#1;
if(!publish_valid||!snapshot_ready||snapshot_overflow)$fatal(1,"edge missing due/pop/capture");
@(negedge clk);frame_done=0;#1;if(snapshots_pending!=16||pending_frames!=16||snapshot_history_lost)$fatal(1,"edge aftermath");
for(i=0;i<15;i=i+1)begin if(!frame_valid)$fatal(1,"frame absent");frame_ready=1;frame_done=1;@(negedge clk);frame_ready=0;frame_done=0;@(negedge clk);end
if(!snapshot_change_valid||snapshot_change_first!=17||snapshot_change_last!=17)$fatal(1,"wrong final provenance %d %d valid %d",snapshot_change_first,snapshot_change_last,snapshot_change_valid);
$display("PASS real timeline full-queue tick, due publication and pop/capture same edge; old snapshots retire before final provenance");$finish;end
initial begin #1000000;$fatal(1,"timeout");end
endmodule
