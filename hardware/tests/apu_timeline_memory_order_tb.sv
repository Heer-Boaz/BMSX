`timescale 1ns/1ps
// Characterisation of the actual timeline and upload commit owners. One
// synchronous word represents the backing store; this deliberately does not
// claim a pin-model or complete DMA/CPU test. CASE=0 delays epoch creation
// until an overdue frame starts; CASE=1 opens it on the actual edge. The
// comparison exposes why frame debt alone is not a memory snapshot.
module apu_timeline_memory_order_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,executor_busy=1,frame_ready=0,frame_done=0;
 wire timeline_ready,frame_valid,frame_tick;wire [31:0] sample_sequence,completed_sequence;wire [63:0] pending_frames;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.snapshot_overflow(1'b0),.snapshot_history_lost(),.executor_busy(executor_busy),
  .timeline_ready(timeline_ready),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .sample_sequence(sample_sequence),.completed_sequence(completed_sequence),.pending_frames(pending_frames),.frame_tick(frame_tick));
 reg stage_valid=0,start_valid=0;wire start_ready,batch_busy,publish_valid;
 reg [31:0] stage_word=32'haabbccdd;reg [16:0] live_address=0;
 reg epoch_begin=0,epoch_end=0;wire epoch_active;
 reg read_valid=0;wire read_ready,read_rsp_valid;wire [31:0] read_rsp_word;
 wire store_req_valid,store_req_write;wire [16:0] store_req_address;
 wire [31:0] store_req_data;wire [3:0] store_req_be;
 reg store_rsp_valid=0;reg [31:0] store_rsp_data=0,backing=32'h11223344;
 wire [6:0] queued_words;
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),
  .stage_valid(stage_valid),.stage_index(4'd0),.stage_word(stage_word),
  .start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),
  .live_word_address(live_address),.batch_busy(batch_busy),.publish_valid(publish_valid),
  .publish_words(),.publish_base(),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),
  .epoch_begin(epoch_begin),.epoch_end(epoch_end),.epoch_active(epoch_active),.queued_words(queued_words),.epoch_words(),
  .read_valid(read_valid),.read_ready(read_ready),.read_word_address(17'd0),.read_rsp_valid(read_rsp_valid),.read_rsp_word(read_rsp_word),
  .memory_ready(1'b1),.store_req_valid(store_req_valid),.store_req_ready(1'b1),.store_req_write(store_req_write),
  .store_req_word_address(store_req_address),.store_req_wdata(store_req_data),.store_req_be_n(store_req_be),
  .store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_data));
 always @(posedge clk) begin
  store_rsp_valid<=store_req_valid;
  if(store_req_valid) begin
   if(store_req_address!==0 || store_req_be!==0)$fatal(1,"unexpected store request");
   if(store_req_write) backing<=store_req_data;
   else store_rsp_data<=backing;
  end
 end
 integer early=0,saturation=0,n;
 initial begin
  if(!$value$plusargs("EARLY=%d",early))early=0;
  if(!$value$plusargs("SATURATION=%d",saturation))saturation=0;
  repeat(2)@(negedge clk);reset_n=1;
  wait(frame_tick);@(negedge clk);
  if(early)epoch_begin=1;
  @(negedge clk);epoch_begin=0;
  if(sample_sequence!=1 || pending_frames!=1)$fatal(1,"expected one due edge");
  if(saturation) begin
   if(!early)$fatal(1,"saturation case requires the opening snapshot");
   // One accepted one-word batch per 32 clocks; all addresses are distinct.
   // The physical queue is finite and this deliberately leaves epoch open.
   for(n=0;n<64;n=n+1) begin
    stage_word=n;live_address=n;stage_valid=1;@(negedge clk);stage_valid=0;
    if(!start_ready)$fatal(1,"unexpected denial at batch %0d",n);
    start_valid=1;@(negedge clk);start_valid=0;
    wait(publish_valid);@(negedge clk);
   end
   @(negedge clk);#1;if(queued_words!==64 || start_ready)$fatal(1,"queue capacity: queued=%0d ready=%0d pending=%0d",queued_words,start_ready,pending_frames);
   if(pending_frames<3)$fatal(1,"expected more output edges during stalled epoch");
   $display("PASS finite 64-word snapshot queue fills after %0d one-word batches, due frames=%0d; next batch is not admitted",n,pending_frames);
   $finish;
  end
  stage_valid=1;@(negedge clk);stage_valid=0;start_valid=1;
  if(!start_ready)$fatal(1,"unexpected denied batch");
  @(negedge clk);start_valid=0;
  wait(publish_valid);@(negedge clk);
  if(early) begin
   repeat(8)@(negedge clk);
   if(backing!==32'h11223344 || queued_words!==1)$fatal(1,"early snapshot not protected");
  end else begin
   wait(queued_words==0);repeat(2)@(negedge clk);
   if(backing!==32'haabbccdd)$fatal(1,"physical write was not committed");
  end
  executor_busy=0;wait(frame_valid);@(negedge clk);frame_ready=1;
  if(!early)epoch_begin=1;
  @(negedge clk);frame_ready=0;epoch_begin=0;
  read_valid=1;while(!read_ready)@(negedge clk);
  @(negedge clk);read_valid=0;while(!read_rsp_valid)@(negedge clk);
  if(early && read_rsp_word!==32'h11223344)$fatal(1,"edge snapshot lost old sample");
  if(!early && read_rsp_word!==32'haabbccdd)$fatal(1,"deferred snapshot characterization unexpected");
  $display("PASS EARLY=%0d frame edge value=11223344, deferred frame read=%h, snapshot storage=%s",early,read_rsp_word,early ? "before-write" : "after-write");
  frame_done=1;epoch_end=1;@(negedge clk);frame_done=0;epoch_end=0;
  $finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
