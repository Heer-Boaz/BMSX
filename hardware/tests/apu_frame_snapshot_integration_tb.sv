`timescale 1ns/1ps
// Actual command sequencer and frame timeline coupled to the DMA publication
// owner and BADP decoder. Backing storage is a one-clock word-memory fixture;
// neither the sample-store/SRAM pins nor the complete playback engine are used.
module apu_frame_snapshot_integration_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0;
 wire timeline_ready,frame_valid,frame_tick; reg frame_ready=0,frame_done=0;
 wire [31:0] sample_sequence,completed_sequence;wire [63:0] pending_frames;
 wire busy,command_consume,action_valid;
 wire snapshot_ready,snapshot_overflow,snapshot_history_lost;
 reg command_valid=1,action_ready=0;
 reg [671:0] command_parameters=0;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.executor_busy(busy),
  .snapshot_overflow(snapshot_overflow),.snapshot_history_lost(snapshot_history_lost),
  .timeline_ready(timeline_ready),.frame_valid(frame_valid),.frame_ready(frame_ready),
  .frame_done(frame_done),.sample_sequence(sample_sequence),.completed_sequence(completed_sequence),
  .pending_frames(pending_frames),.frame_tick(frame_tick));
 apu_command_executor executor(.clk(clk),.reset_n(reset_n),.service_ready(timeline_ready),
  .command_valid(command_valid),.command_consume(command_consume),.command_word(32'd1),
  .command_parameters(command_parameters),.selected_cartridge(1'b0),.busy(busy),
  .reservation_valid(),.query_slot(),.slot_phase(3'd0),.bind_valid(),.bind_ready(1'b0),
  .bind_parameters(),.bind_cartridge(),.bind_rsp_valid(1'b0),.bind_rsp_ready(),.bind_rsp_ok(1'b0),
  .action_valid(action_valid),.action_ready(action_ready),.action_bank_op(),.action_command(),
  .action_slot(),.action_parameters(),.action_phase(),.action_index(),.action_word(),.action_cartridge(),
  .fault_valid(),.fault_ready(1'b1),.fault_code(),.fault_detail());
 always @(posedge clk) if(command_consume) command_valid<=0;
 wire epoch_begin=frame_tick,epoch_end=frame_done;
 wire decoder_begin=frame_valid && frame_ready;
 wire snapshot_change_valid;wire [16:0] snapshot_change_first,snapshot_change_last;
 wire req_ready,rsp_valid;wire [31:0] rsp_samples;
 wire memory_req_valid;wire [16:0] memory_req_word_address;
 reg [31:0] memory [0:127];
 reg stage_valid=0,start_valid=0;
 wire start_ready,batch_busy,publish_valid,read_ready,read_rsp_valid,store_req_valid,store_req_write;
 wire [4:0] snapshots_pending,publish_words;wire [16:0] publish_base;
 wire [31:0] read_rsp_word,store_req_wdata;wire [16:0] store_req_addr;
 reg store_rsp_valid=0;reg [31:0] store_rsp_rdata=0;wire upload_epoch_active;
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),
  .stage_valid(stage_valid),.stage_index(4'd0),.stage_word(32'h001403e8),
  .start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),
  .live_word_address(17'd17),.batch_busy(batch_busy),.publish_valid(publish_valid),
  .publish_words(publish_words),.publish_base(publish_base),.commit_valid(),.commit_words(),.commit_base(),
  .commit_next_address(),.epoch_begin(epoch_begin),.epoch_end(epoch_end),.epoch_active(upload_epoch_active),
  .snapshot_change_valid(snapshot_change_valid),.snapshot_change_first(snapshot_change_first),
  .snapshot_change_last(snapshot_change_last),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),
  .snapshots_pending(snapshots_pending),.queued_words(),.epoch_words(),
  .read_valid(memory_req_valid),.read_ready(read_ready),.read_word_address(memory_req_word_address),
  .read_rsp_valid(read_rsp_valid),.read_rsp_word(read_rsp_word),.memory_ready(1'b1),
  .store_req_valid(store_req_valid),.store_req_ready(1'b1),.store_req_write(store_req_write),
  .store_req_word_address(store_req_addr),.store_req_wdata(store_req_wdata),.store_req_be_n(),
  .store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_rdata));
 always @(posedge clk) begin
  store_rsp_valid<=reset_n&&store_req_valid;
  if(store_req_valid) begin
   if(store_req_write) memory[store_req_addr]<=store_req_wdata;
   else store_rsp_rdata<=memory[store_req_addr];
  end
 end
 reg bind_valid=0,req_valid=0,req_reset=0;reg [31:0] req_frame=0;
 apu_badp_decoder decoder(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(4'd0),
  .bind_source_base(19'd0),.bind_source_bytes(20'd4),.bind_data_offset(19'd64),.bind_frames(32'd8),
  .bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd8),
  .req_valid(req_valid),.req_ready(req_ready),.req_reset(req_reset),.req_voice(4'd0),.req_frame(req_frame),
  .rsp_valid(rsp_valid),.rsp_samples(rsp_samples),.source_write_valid(publish_valid),
  .source_write_word(publish_base),.source_write_words(publish_words),.epoch_begin(decoder_begin),
  .epoch_active(upload_epoch_active),.epoch_change_valid(snapshot_change_valid),
  .epoch_change_first(snapshot_change_first),.epoch_change_last(snapshot_change_last),
  .memory_req_valid(memory_req_valid),.memory_req_ready(read_ready),.memory_req_word_address(memory_req_word_address),
  .memory_rsp_valid(read_rsp_valid),.memory_rsp_word(read_rsp_word));
 task automatic request(input bit reset_op,input [31:0] frame,input [31:0] expected);
  begin @(negedge clk);while(!req_ready)@(negedge clk);req_reset=reset_op;req_frame=frame;req_valid=1;
   @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
   if(!reset_op && rsp_samples!==expected)$fatal(1,"frame %0d expected %h actual %h",frame,expected,rsp_samples);
  end
 endtask
 task automatic start_frame;
  begin @(negedge clk);while(!frame_valid)@(negedge clk);frame_ready=1;
   @(negedge clk);frame_ready=0;
  end
 endtask
 task automatic end_frame;
  begin @(negedge clk);frame_done=1;@(negedge clk);frame_done=0;end
 endtask
 integer i;
 initial begin
  for(i=0;i<128;i=i+1) memory[i]=0;
  memory[16]=32'h000c0008;memory[17]=32'h00140064;memory[18]=32'h11111111;
  command_parameters[19*32 +:32]=1; // non-ROM generator: defer accepted action
  repeat(2)@(negedge clk);reset_n=1;
  @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  wait(action_valid);while(!frame_tick)@(negedge clk);@(negedge clk);
  if(snapshots_pending!==1 || pending_frames!==1 || !busy)$fatal(1,"first edge not captured during stalled command");
  stage_valid=1;@(negedge clk);stage_valid=0;if(!start_ready)$fatal(1,"upload not admitted");start_valid=1;
  @(negedge clk);start_valid=0;wait(publish_valid);@(negedge clk);
  while(!frame_tick)@(negedge clk);@(negedge clk);
  if(snapshots_pending!==2 || pending_frames!==2 || snapshot_overflow || snapshot_history_lost)$fatal(1,"second edge missing");
  action_ready=1;@(negedge clk);action_ready=0;wait(!busy);
  start_frame();request(1,0,0);request(0,0,32'h00760076);request(0,1,32'h00860086);request(0,2,32'h00950095);end_frame();
  if(snapshots_pending!==1 || completed_sequence!==1)$fatal(1,"first completion did not retire matching snapshot");
  start_frame();request(0,2,32'h00950095);request(0,1,32'h00860086);request(0,0,32'h03fa03fa);end_frame();
  #1;if(snapshots_pending!==0 || completed_sequence!==2 || pending_frames!==0)$fatal(1,"frame and memory timelines diverged");
  $display("PASS actual command stall, 768-clock timeline, two delayed frame snapshots, published BADP change and ordered decoder checkpoints; word-memory fixture");
  // A longer reservation must not masquerade as a successful snapshot: the
  // physical fence bank has 16 entries whereas the timeline counts every edge.
  // Expose the real mismatch, rather than defining an unapproved recovery.
  @(negedge clk);reset_n=0;command_valid=1;action_ready=0;@(negedge clk);reset_n=1;
  wait(action_valid);
  for(i=0;i<17;i=i+1) begin
   while(!frame_tick)@(negedge clk);
   #1;
   if(i<16 && (!snapshot_ready || snapshot_overflow))$fatal(1,"premature snapshot overflow at %0d",i);
   if(i==16 && (snapshot_ready || !snapshot_overflow))$fatal(1,"17th missing snapshot not exposed");
   @(negedge clk);
  end
  if(snapshots_pending!==16 || pending_frames!==17 || !snapshot_history_lost)$fatal(1,"bounded fence mismatch not represented");
  action_ready=1;@(negedge clk);action_ready=0;wait(!busy);
  for(i=0;i<16;i=i+1) begin
   @(negedge clk);if(!frame_valid)$fatal(1,"missing admitted frame %0d",i);
   frame_ready=1;frame_done=1;
   @(negedge clk);frame_ready=0;frame_done=0;
  end
  #1;
  if(snapshots_pending!==0 || pending_frames!==1 || !frame_valid || snapshot_overflow || !snapshot_history_lost)
   $fatal(1,"unbacked frame characterization changed");
  $display("CHARACTERIZED OPEN INTEGRATION: 17th tick reports overflow and sticky history loss; after 16 retires timeline still offers one unbacked frame; no recovery or public fault behavior defined");
  @(negedge clk);reset_n=0;@(negedge clk);if(snapshot_history_lost)$fatal(1,"history-loss latch did not reset");
  $finish;
 end
 initial begin #4000000;$fatal(1,"timeout");end
endmodule
