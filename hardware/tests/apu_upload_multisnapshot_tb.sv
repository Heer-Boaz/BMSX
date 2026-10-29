`timescale 1ns/1ps
// Real output-edge timeline and upload memory owner. The one-word backing
// service is deliberately a deterministic response fixture, not SRAM pin timing.
// Three samples occur while playback is held; intervening accepted batches
// change one address. Each sample must see the memory as of its own edge.
module apu_upload_multisnapshot_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,executor_busy=1,frame_ready=0,frame_done=0;
 wire timeline_ready,frame_valid,frame_tick,snapshot_history_lost,snapshot_overflow;wire [31:0] sample_sequence,completed_sequence;wire [63:0] pending_frames;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.snapshot_overflow(snapshot_overflow),.snapshot_history_lost(snapshot_history_lost),.executor_busy(executor_busy),.timeline_ready(timeline_ready),
  .frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.sample_sequence(sample_sequence),
  .completed_sequence(completed_sequence),.pending_frames(pending_frames),.frame_tick(frame_tick));
 reg manual=0,manual_begin=0,manual_end=0;
 wire epoch_begin=manual?manual_begin:frame_tick,epoch_end=manual?manual_end:frame_done;
 reg stage_valid=0,start_valid=0;reg [31:0] stage_word=0;wire start_ready,batch_busy,publish_valid;
 reg [16:0] live_word_address=0;reg read_valid=0;wire read_ready,read_rsp_valid;wire [31:0] read_rsp_word;
 wire snapshot_ready,epoch_active; wire snapshot_change_valid; wire [16:0] snapshot_change_first,snapshot_change_last;wire [4:0] snapshots_pending;wire [6:0] queued_words,epoch_words;
 wire store_req_valid,store_req_write;wire [16:0] store_req_word_address;wire [31:0] store_req_wdata;wire [3:0] store_req_be_n;
 reg store_rsp_valid=0;reg [31:0] store_rsp_rdata=0,backing=32'h11111111;
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.stage_valid(stage_valid),.stage_index(4'd0),.stage_word(stage_word),
  .start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),.live_word_address(live_word_address),
  .batch_busy(batch_busy),.publish_valid(publish_valid),.publish_words(),.publish_base(),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),
  .epoch_begin(epoch_begin),.epoch_end(epoch_end),.epoch_active(epoch_active),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),
  .snapshots_pending(snapshots_pending),.snapshot_change_valid(snapshot_change_valid),.snapshot_change_first(snapshot_change_first),.snapshot_change_last(snapshot_change_last),.queued_words(queued_words),.epoch_words(epoch_words),
  .read_valid(read_valid),.read_ready(read_ready),.read_word_address(17'd0),.read_rsp_valid(read_rsp_valid),.read_rsp_word(read_rsp_word),
  .memory_ready(1'b1),.store_req_valid(store_req_valid),.store_req_ready(1'b1),.store_req_write(store_req_write),
  .store_req_word_address(store_req_word_address),.store_req_wdata(store_req_wdata),.store_req_be_n(store_req_be_n),
  .store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_rdata));
 always @(posedge clk) begin
  store_rsp_valid<=reset_n && store_req_valid;
  if(store_req_valid) begin
   if(store_req_word_address!==0 || store_req_be_n!==0)$fatal(1,"unexpected backing access");
   if(store_req_write)backing<=store_req_wdata;else store_rsp_rdata<=backing;
  end
 end
 task automatic await_tick;
  begin while(!frame_tick)@(negedge clk);if(!snapshot_ready||snapshot_overflow)$fatal(1,"unaccepted sample edge");@(negedge clk);end
 endtask
 task automatic write_word(input [31:0] value);
  begin @(negedge clk);stage_word=value;stage_valid=1;@(negedge clk);stage_valid=0;
   if(!start_ready)$fatal(1,"batch admission");start_valid=1;@(negedge clk);start_valid=0;
   wait(publish_valid);@(negedge clk);end
 endtask
 task automatic read_frame(input [31:0] value);
  begin while(!frame_valid)@(negedge clk);frame_ready=1;@(negedge clk);frame_ready=0;
   read_valid=1;while(!read_ready)@(negedge clk);@(negedge clk);read_valid=0;
   while(!read_rsp_valid)@(negedge clk);
   if(read_rsp_word!==value)$fatal(1,"snapshot %0d expected %h got %h",completed_sequence,value,read_rsp_word);
   frame_done=1;@(negedge clk);frame_done=0;
  end
 endtask
 integer n;
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  await_tick();write_word(32'h22222222);await_tick();write_word(32'h33333333);await_tick();
  if(snapshots_pending!==3||pending_frames!==3||backing!==32'h11111111)$fatal(1,"edge fences not retained");
  if(snapshot_change_valid)$fatal(1,"first snapshot provenance");
  executor_busy=0;read_frame(32'h11111111);#1;
  if(!snapshot_change_valid || snapshot_change_first!=0 || snapshot_change_last!=0)$fatal(1,"second snapshot provenance");
  read_frame(32'h22222222);#1;
  if(!snapshot_change_valid || snapshot_change_first!=0 || snapshot_change_last!=0)$fatal(1,"third snapshot provenance");
  read_frame(32'h33333333);
  @(negedge clk);if(snapshots_pending!==0 || completed_sequence!==3)$fatal(1,"ordered retire");
  $display("PASS 3 actual sample edges retain 3 historical SRAM views across later publications");
  // A batch completing exactly on the edge must be visible in that sample.
  reset_n=0;backing=32'h11111111;executor_busy=1;@(negedge clk);reset_n=1;
  stage_valid=1;stage_word=32'h55667788;@(negedge clk);stage_valid=0;
  while(timeline.phase!=735)@(negedge clk);if(!start_ready)$fatal(1,"edge batch admission");start_valid=1;
  @(negedge clk);start_valid=0;while(!frame_tick)@(negedge clk);
  if(!publish_valid)$fatal(1,"batch not coincident with frame edge");@(negedge clk);
  executor_busy=0;read_frame(32'h55667788);
  $display("PASS due publication on sample edge belongs to that edge snapshot");
  // When another frame already owns the old snapshot, a write coincident
  // with the next frame edge must not leak into that old frame's read.
  reset_n=0;backing=32'h11111111;executor_busy=1;@(negedge clk);reset_n=1;
  await_tick();stage_valid=1;stage_word=32'ha1b2c3d4;@(negedge clk);stage_valid=0;
  while(timeline.phase!=735)@(negedge clk);if(!start_ready)$fatal(1,"overlapping edge batch admission");start_valid=1;
  @(negedge clk);start_valid=0;while(!frame_tick)@(negedge clk);
  if(!publish_valid || snapshots_pending!=1)$fatal(1,"overlapping edge setup");
  read_valid=1;#1;if(!read_ready)$fatal(1,"old frame read not accepted");
  @(negedge clk);read_valid=0;while(!read_rsp_valid)@(negedge clk);
  if(read_rsp_word!==32'h11111111)$fatal(1,"new-edge write leaked to old frame");
  executor_busy=0;read_frame(32'h11111111);read_frame(32'ha1b2c3d4);
  $display("PASS coincident next-edge write remains invisible to the prior frame");
  // Explicit bounded snapshot capacity and full simultaneous pop/push.
  reset_n=0;manual=1;executor_busy=1;@(negedge clk);reset_n=1;
  for(n=0;n<16;n=n+1) begin @(negedge clk);manual_begin=1;#1;if(!snapshot_ready)$fatal(1,"snapshot slot %0d",n);
   @(negedge clk);manual_begin=0;end
  if(snapshots_pending!==16||snapshot_ready)$fatal(1,"snapshot capacity");
  @(negedge clk);stage_valid=1;stage_word=32'h87654321;
  @(negedge clk);stage_valid=0;if(!start_ready)$fatal(1,"full coincident batch admission");start_valid=1;
  @(negedge clk);start_valid=0;while(!publish_valid)@(negedge clk);
  manual_begin=1;manual_end=1;#1;if(!snapshot_ready||snapshot_overflow)$fatal(1,"full simultaneous publish/retire/capture");
  @(negedge clk);manual_begin=0;manual_end=0;if(snapshots_pending!==16)$fatal(1,"full replacement count");
  for(n=0;n<15;n=n+1) begin
   #1;if(snapshot_change_valid)$fatal(1,"future write leaked into prior fence %0d",n);
   @(negedge clk);manual_end=1;@(negedge clk);manual_end=0;
  end
  #1;if(!snapshot_change_valid || snapshot_change_first!=0 || snapshot_change_last!=0)
   $fatal(1,"simultaneous publication missing from replacement fence");
  for(n=0;n<15;n=n+1) begin @(negedge clk);manual_begin=1;@(negedge clk);manual_begin=0;end
  @(negedge clk);manual_begin=1;#1;if(snapshot_ready||!snapshot_overflow)$fatal(1,"overflow not visible");
  @(negedge clk);manual_begin=0;if(snapshots_pending!==16 || !snapshot_history_lost)$fatal(1,"overflow overwrote snapshots or was lost");
  $display("PASS finite 16-fence capacity, explicit overflow and simultaneous full retire/capture");
  reset_n=0;manual_begin=0;manual_end=0;@(negedge clk);if(snapshot_history_lost)$fatal(1,"reset retained overflow");reset_n=1;
  @(negedge clk);stage_valid=1;stage_word=32'h1;
  @(negedge clk);stage_valid=0;if(!start_ready)$fatal(1,"empty batch admission");start_valid=1;
  @(negedge clk);start_valid=0;while(!publish_valid)@(negedge clk);
  manual_begin=1;#1;
  if(!snapshot_change_valid || snapshot_change_first!=0 || snapshot_change_last!=0)
   $fatal(1,"first edge did not forward its coincident publication");
  @(negedge clk);manual_begin=0;#1;
  if(!snapshot_change_valid)$fatal(1,"first captured change not retained");
  $display("PASS first empty snapshot exposes same-edge publication before and after capture");$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
