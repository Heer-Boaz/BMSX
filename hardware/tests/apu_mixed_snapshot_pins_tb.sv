`timescale 1ns/1ps
// Real sample-publication/snapshot owner and the mixed PCM/BADP mixer. A
// ISSI pin-timed sample SRAM supplies the physical backing store; pending
// frame edges and source configuration are supplied by the test rather than full APU MMIO.
module apu_mixed_snapshot_pins_tb;
 localparam real PERIOD=1000000000.0/33868800.0;
 reg clk=0;always #(PERIOD/2.0) clk=~clk;integer cycle=0;always @(posedge clk)cycle=cycle+1;
 reg reset_n=0,edge_open=0,edge_close=0;
 reg stage_valid=0,start_valid=0;reg [3:0] stage_index=0;reg [31:0] stage_word=0;reg [4:0] start_words=1;reg [16:0] live_word_address=100;wire start_ready,batch_busy,publish_valid;wire [4:0] publish_words;
 wire [16:0] publish_base;wire epoch_active,snapshot_ready,snapshot_overflow,snapshot_changed;wire [16:0] change_first,change_last;
 wire badp_req,pcm_req,read_ready,read_rsp,store_valid,store_write,read_rsp_pcm;wire [16:0] badp_addr,store_addr;wire [31:0] pcm_addr,read_word,store_wdata;
 wire store_rsp,store_ready,memory_ready;wire [31:0] store_rdata;wire [3:0] store_be_n;wire [6:0] queued_words;reg response_pcm=0;
 wire [17:0] mem_address;tri [15:0] mem_data;wire mem_ce_n,mem_oe_n,mem_we_n;wire [1:0] mem_be_n;
 apu_sample_store store(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.req_valid(store_valid),.req_ready(store_ready),.req_write(store_write),
  .req_word_address(store_addr),.req_wdata(store_wdata),.req_be_n(store_be_n),.rsp_valid(store_rsp),.rsp_rdata(store_rdata),.memory_ready(memory_ready),
  .mem_address(mem_address),.mem_data(mem_data),.mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n));
 issi_bll_pin_model #(.ADDRESS_WIDTH(18)) ram(.address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),.we_n(mem_we_n),.be_n(mem_be_n),.drive_active());
 wire source_valid=badp_req||pcm_req;wire source_ready,source_rsp;
 wire [31:0] source_word,source_fault;wire source_timeout;
 wire read_valid;wire [16:0] read_addr;
 apu_source_word_router source_router(.clk(clk),.reset_n(reset_n),
  .req_valid(source_valid),.req_ready(source_ready),.req_local(1'b1),
  .req_local_word(pcm_req ? pcm_addr[18:2] : badp_addr),.req_rom_address(32'd0),.req_rom_signals(8'd0),
  .req_timeout_enable(1'b0),.req_wait_last(18'd0),
  .local_valid(read_valid),.local_ready(read_ready),.local_word(read_addr),
  .local_rsp_valid(read_rsp),.local_rsp_data(read_word),
  .rom_valid(),.rom_ready(1'b0),.rom_address(),.rom_signals(),.rom_timeout_enable(),.rom_wait_last(),
  .rom_rsp_valid(1'b0),.rom_rsp_ready(),.rom_rsp_data(32'd0),.rom_rsp_fault(32'd0),.rom_rsp_timeout(1'b0),
  .rsp_valid(source_rsp),.rsp_ready(1'b1),.rsp_data(source_word),.rsp_fault(source_fault),.rsp_timeout(source_timeout));
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.stage_valid(stage_valid),.stage_index(stage_index),
  .stage_word(stage_word),.start_valid(start_valid),.start_ready(start_ready),.start_words(start_words),.cancel(1'b0),.live_word_address(live_word_address),
  .batch_busy(batch_busy),.publish_valid(publish_valid),.publish_words(publish_words),.publish_base(publish_base),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),
  .epoch_begin(edge_open),.epoch_end(edge_close),.epoch_active(epoch_active),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),.snapshots_pending(),
  .snapshot_change_valid(snapshot_changed),.snapshot_change_first(change_first),.snapshot_change_last(change_last),.queued_words(queued_words),.epoch_words(),
  .read_valid(read_valid),.read_ready(read_ready),.read_word_address(read_addr),.read_rsp_valid(read_rsp),.read_rsp_word(read_word),.memory_ready(memory_ready),
  .store_req_valid(store_valid),.store_req_ready(store_ready),.store_req_write(store_write),.store_req_word_address(store_addr),.store_req_wdata(store_wdata),.store_req_be_n(store_be_n),
  .store_rsp_valid(store_rsp),.store_rsp_rdata(store_rdata));
 integer pcm_reads=0,pcm_responses=0,badp_reads=0,badp_responses=0,physical_reads=0;
 reg first_snapshot_retired=0,forwarded_pcm_seen=0,pcm_write_pending=0;
 always @(posedge clk)begin
  if(edge_close && epoch_active)first_snapshot_retired<=1;
  if(source_valid && source_ready)response_pcm<=pcm_req;
  if(source_rsp && (source_fault!=0 || source_timeout))$fatal(1,"unexpected source fault");
  if(read_valid && read_ready)begin
   if(response_pcm)begin
    if(read_addr!==17'd100 || pcm_reads>=2)$fatal(1,"unexpected PCM read %h",read_addr);
    pcm_reads<=pcm_reads+1;
   end else begin
    if(badp_reads>=3 || read_addr!==(17'd16+badp_reads))$fatal(1,"unexpected BADP word %h",read_addr);
    badp_reads<=badp_reads+1;
   end
  end
  if(read_rsp)begin
   if(response_pcm)begin
    if(pcm_responses==0 && read_word!==32'd1000)$fatal(1,"old snapshot PCM %h",read_word);
    if(pcm_responses==1 && read_word!==32'd3000)$fatal(1,"new snapshot PCM %h",read_word);
    if(pcm_responses>=2)$fatal(1,"extra PCM response");
    if(pcm_responses==1 && pcm_write_pending)forwarded_pcm_seen<=1;
    pcm_responses<=pcm_responses+1;
   end else begin
    case(badp_responses)
     0:if(read_word!==32'h000c0008)$fatal(1,"BADP block header %h",read_word);
     1:if(read_word!==32'h00140064)$fatal(1,"BADP predictor/index %h",read_word);
     2:if(read_word!==32'h11111111)$fatal(1,"BADP payload %h",read_word);
     default:$fatal(1,"extra BADP response");
    endcase
    badp_responses<=badp_responses+1;
   end
  end
  if(store_valid && store_ready)begin
   if(!store_write)physical_reads<=physical_reads+1;
   if(store_write && store_addr==17'd100 && store_wdata==32'd3000 && !first_snapshot_retired && !edge_close)
    $fatal(1,"new PCM reached SRAM before the oldest snapshot retired");
   if(store_write && store_addr==17'd100 && store_wdata==32'd3000)pcm_write_pending<=1;
  end
  if(store_rsp && pcm_write_pending)pcm_write_pending<=0;
  if(badp_req && pcm_req)$fatal(1,"two codecs used one word port at once");
  if(pcm_req && (pcm_addr<32'h40000000 || pcm_addr>=32'h40000200))$fatal(1,"PCM address %h",pcm_addr);
 end
 reg bind_valid=0,start_valid_mix=0,slot_valid=0,slot_active=0,slot_reset=0,output_ready=0;
 reg [31:0] slot_bits=0,slot_data_address=0,slot_channels=1;wire start_ready_mix,slot_ready,frame_valid;wire signed [15:0] left,right;
 apu_badp_mix mixer(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(4'd1),.bind_source_base(19'd0),.bind_source_bytes(20'd128),
  .bind_data_offset(19'd64),.bind_frames(32'd8),.bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd8),
  .source_write_valid(publish_valid),.source_write_word(publish_base),.source_write_words(publish_words),.epoch_begin(start_valid_mix && start_ready_mix),.epoch_active(epoch_active),
  .epoch_change_valid(snapshot_changed),.epoch_change_first(change_first),.epoch_change_last(change_last),
  .memory_req_valid(badp_req),.memory_req_ready(source_ready),.memory_req_word_address(badp_addr),.memory_rsp_valid(source_rsp && !response_pcm),.memory_rsp_word(source_word),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(source_ready),.pcm_memory_req_address(pcm_addr),.pcm_memory_rsp_valid(source_rsp && response_pcm),.pcm_memory_rsp_word(source_word),
  .start_valid(start_valid_mix),.start_ready(start_ready_mix),.slot_valid(slot_valid),.slot_ready(slot_ready),.slot_active(slot_active),.slot_generator_kind(32'd0),.slot_generator_duty_q12(32'd0),.slot_reset(slot_reset),
  .slot_bits_per_sample(slot_bits),.slot_channels(slot_channels),.slot_data_address(slot_data_address),.slot_frame(32'd0),.slot_neighbor(32'd0),.slot_fraction(16'd0),
  .slot_gain_q12(32'sd4096),.slot_level_lr_q14(32'h40004000),.slot_filter_clear(1'b0),.slot_filter_control(32'd0),.slot_filter_b0_b1(32'd0),.slot_filter_b2_a1(32'd0),.slot_filter_a2(32'd0),
  .frame_valid(frame_valid),.frame_ready_out(output_ready),.frame_left(left),.frame_right(right));
 task automatic stage(input [3:0] index,input [31:0] word);
  begin @(negedge clk);stage_index=index;stage_word=word;stage_valid=1;@(negedge clk);stage_valid=0;end
 endtask
 task automatic upload_words(input [16:0] address,input [4:0] words);
  begin @(negedge clk);live_word_address=address;start_words=words;while(!start_ready)@(negedge clk);start_valid=1;
   @(negedge clk);start_valid=0;wait(publish_valid);@(negedge clk);wait(queued_words==0 && !batch_busy);@(negedge clk);
  end
 endtask
 task automatic capture;begin @(negedge clk);if(!snapshot_ready)$fatal(1,"unexpected snapshot full");edge_open=1;@(negedge clk);edge_open=0;end endtask
 task automatic render(input bit reset_badp,input [31:0] expected);
  integer i,start_cycle;
  begin @(negedge clk);while(!start_ready_mix)@(negedge clk);start_cycle=cycle;start_valid_mix=1;@(negedge clk);start_valid_mix=0;
   for(i=0;i<16;i=i+1)begin @(negedge clk);while(!slot_ready)@(negedge clk);
    slot_valid=1;slot_active=(i<2);slot_reset=(i==1 && reset_badp);slot_bits=(i==0?16:4);slot_data_address=32'h40000190;
    @(negedge clk);slot_valid=0;end
   while(!frame_valid)@(negedge clk);$display("Mixed local SRAM snapshot frame: %0d SYS cycles (two active slots, stimulus included)",cycle-start_cycle);if({right,left}!==expected)$fatal(1,"snapshot got %h expected %h",{right,left},expected);
   repeat(2)begin @(negedge clk);if(!frame_valid||{right,left}!==expected)$fatal(1,"frame stall");end
   output_ready=1;edge_close=1;@(negedge clk);output_ready=0;edge_close=0;
  end
 endtask
 integer i,f,rc,count;reg [31:0] expected0,expected1;
 initial begin
  f=$fopen("build/tests/apu-mixed-snapshot-vectors.txt","r");if(!f)$fatal(1,"missing TS/C++ vectors");
  rc=$fscanf(f,"%d %h %h",count,expected0,expected1);if(rc!=3 || count!=2)$fatal(1,"invalid vector file");
  repeat(2)@(negedge clk);reset_n=1;wait(memory_ready);
  stage(0,32'h000c0008);stage(1,32'h00140064);stage(2,32'h11111111);upload_words(16,3);
  stage(0,32'h000003e8);upload_words(100,1);
  @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  capture();stage(0,32'h00000bb8);live_word_address=100;start_words=1;
  while(!start_ready)@(negedge clk);start_valid=1;@(negedge clk);start_valid=0;
  wait(publish_valid);@(negedge clk);capture();
  if(snapshot_overflow)$fatal(1,"snapshot overflow");
  render(1,expected0);render(0,expected1);
  if(epoch_active)$fatal(1,"snapshots did not retire");
  if(pcm_reads!=2 || pcm_responses!=2 || badp_reads!=3 || badp_responses!=3 || physical_reads!=4)
   $fatal(1,"unexpected PCM/BADP/physical read counts %0d/%0d %0d/%0d %0d",pcm_reads,pcm_responses,badp_reads,badp_responses,physical_reads);
  if(!forwarded_pcm_seen)$fatal(1,"new snapshot did not forward PCM during the backing write");
  $display("PASS PCM/BADP mixed reads share actual upload/snapshot owner and real ISSI SRAM pins: 1000 then 3000 across delayed views, BADP retained, TS/C++ outputs");$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
