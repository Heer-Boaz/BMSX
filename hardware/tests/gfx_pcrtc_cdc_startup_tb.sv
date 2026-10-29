`timescale 1ps/1ps
// Actual CORE packet master -> PCRTC endpoint -> physical startup, FIFO and
// display epoch. Source and video reset release are owned by the integration;
// the endpoint waits for the real access-ready handshake.
// No ready is fed back from the FIFO to PCRTC. Clock availability, supervisor
// restoration, FIFO capacity beyond exercised traffic, FIELD, memory reads and
// the DAC deadline are not established by this integration experiment.
// +STOP=1 stops VIDEO after startup and demonstrates actual update loss rather
// than calling an overflowing queue a safe design.
// +FAST_ENDPOINT=1 instead drives the same real endpoint at its minimum
// HEADER/ADDRESS/DATA/RESPONSE spacing, a stress stimulus faster than this
// particular CORE master, and generates adjacent VBlank/reset snapshots.
// It is not a model of an alternative deployed bus master.
module gfx_pcrtc_cdc_startup_tb;
 reg sysclk=0,vidclk=0,reset_n=0,video_run=1;
 integer phase=0,stop=0,fast_endpoint=0,sys_half_ps=14763,video_half_ps=37037;
 initial begin
  if($value$plusargs("SYS_HALF=%d",sys_half_ps)) begin end
  forever begin #(sys_half_ps);sysclk=~sysclk;end
 end
 initial begin
  if($value$plusargs("PHASE=%d",phase)) begin end
  if($value$plusargs("STOP=%d",stop)) begin end
  if($value$plusargs("FAST_ENDPOINT=%d",fast_endpoint)) begin end
  if($value$plusargs("VIDEO_HALF=%d",video_half_ps)) begin end
  #(phase); forever begin #(video_half_ps);if(video_run)vidclk=~vidclk; end
 end
 reg req_valid=0; reg [31:0] req_addr=0,req_data=0;
 wire req_ready,rsp_valid,rsp_timeout,busy;
 wire [31:0] rsp_data,rsp_fault,master_out,endpoint_out;
 wire master_oe,endpoint_oe,ready_low,master_as_n,master_rd_n,master_wr_n;
 wire [3:0] master_be_n;
 reg fast_as_n=1,fast_rd_n=1,fast_wr_n=1,fast_oe=0;
 reg [3:0] fast_be_n=4'hf;reg [31:0] fast_ad=0;
 wire as_n=fast_endpoint ? fast_as_n : master_as_n;
 wire rd_n=fast_endpoint ? fast_rd_n : master_rd_n;
 wire wr_n=fast_endpoint ? fast_wr_n : master_wr_n;
 wire [3:0] be_n=fast_endpoint ? fast_be_n : master_be_n;
 tri [31:0] ad;tri1 ready_n;
 assign ad=fast_endpoint ? (fast_oe ? fast_ad : 32'bz) : (master_oe ? master_out : 32'bz);
 assign ad=endpoint_oe ? endpoint_out : 32'bz;
 assign ready_n=ready_low ? 1'b0 : 1'bz;
 system_bus_master master(.clk(sysclk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(1'b1),.req_addr(req_addr),.req_wdata(req_data),.req_be_n(4'd0),
  .req_header_be_n(4'hf),.bus_busy(busy),.req_meta(32'd0),.req_data_timeout_enable(1'b0),
  .req_data_wait_last(18'd0),.rsp_valid(rsp_valid),.rsp_rdata(rsp_data),.rsp_fault_code(rsp_fault),
  .rsp_timeout(rsp_timeout),.bus_ad_in(ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),
  .bus_as_n(master_as_n),.bus_rd_n(master_rd_n),.bus_wr_n(master_wr_n),.bus_be_n(master_be_n),.bus_ready_n(ready_n));
 wire cfg_valid,cfg_write,cfg_ready;wire [4:0] cfg_index;wire [31:0] cfg_data,cfg_rdata;
 gfx_pcrtc_sys_endpoint endpoint(.clk(sysclk),.reset_n(reset_n),.cs_pcrtc_n(!busy && !fast_endpoint),
  .bus_ad_in(ad),.bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),
  .bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),.bus_ready_drive_low(ready_low),
  .config_valid(cfg_valid),.config_write(cfg_write),.config_index(cfg_index),.config_write_word(cfg_data),
  .config_ready(cfg_ready),.config_read_word(cfg_rdata));
 wire [703:0] programmed,displayed,update_words,video_words;
 wire source_reset_n,video_reset_n,update_valid,update_reset,fifo_ready,fifo_overflow,fifo_history_lost,out_valid;
 wire [704:0] out_data;
 gfx_pcrtc_cdc_startup dut(.sysclk(sysclk),.video_clk(vidclk),.reset_n(reset_n),
  .access_valid(cfg_valid),.access_write(cfg_write),.access_index(cfg_index),.access_wdata(cfg_data),
  .access_ready(cfg_ready),.access_rdata(cfg_rdata),.other_events(5'd0),
  .irq_raise(),.gpu_queue_action(),.gpu_reset_action(),.programmed_words(programmed),.displayed_words(displayed),
  .display_update_valid(update_valid),.display_update_reset(update_reset),.display_update_words(update_words),
  .fifo_ready(fifo_ready),.fifo_overflow(fifo_overflow),.fifo_history_lost(fifo_history_lost),.source_reset_n(source_reset_n),.video_reset_n(video_reset_n),
  .video_update_valid(out_valid),.video_update_reset(out_data[704]),.video_update_words(out_data[703:0]),.video_words(video_words),
  .timing_restart(),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(),.imr_word(),
  .video_running(),.video_sample_valid(),.video_period(),.video_phase(),.video_half_line(),.video_elapsed_half_lines(),
  .video_local_field(),.video_vblank_active(),.video_output_x());
 reg [704:0] expected[0:2047];
 integer sent=0,accepted=0,received=0,overflow=0,reset_events=0,writes=0,early=0;
 integer cycle=0,lastwrite=-1000,minspace=1000,last_event=-1000,adjacent_events=0;
 reg check_latch=0,check_output=0; reg [703:0] last_update,last_output;
 always @(posedge sysclk) if(reset_n) begin
  cycle=cycle+1;
  if((fast_endpoint ? fast_oe : master_oe) && endpoint_oe)$fatal(1,"bus contention");
  if(cfg_valid && cfg_write && cfg_ready)begin
   writes=writes+1;
   if(sent==0)early=early+1;
   if(cycle-lastwrite<minspace)minspace=cycle-lastwrite;
   lastwrite=cycle;
  end
  if(update_valid)begin
   sent=sent+1;
   if(cycle-last_event==1)adjacent_events=adjacent_events+1;
   last_event=cycle;
   if(update_reset)reset_events=reset_events+1;
   check_latch=1;last_update=update_words;
   if(fifo_ready)begin expected[accepted]={update_reset,update_words};accepted=accepted+1;end
   else begin if(!fifo_overflow)$fatal(1,"missing overflow pulse"); overflow=overflow+1; end
  end
 end
 always @(negedge sysclk) if(source_reset_n && check_latch)begin
  if(displayed!==last_update)$fatal(1,"latch / transfer mismatch");check_latch=0;
 end
 always @(posedge vidclk) if(reset_n)begin
  check_output=out_valid;
  if(out_valid)begin
   if(received>=accepted || out_data!==expected[received])$fatal(1,"FIFO order mismatch %0d/%0d",received,accepted);
   last_output=out_data[703:0];received=received+1;
  end
 end
 always @(negedge vidclk) if(reset_n && check_output)
  if(video_words!==last_output)$fatal(1,"output epoch did not retain the accepted snapshot");
 task automatic wr(input [31:0] addr,input [31:0] value);
  begin
   if(fast_endpoint) begin
    while(!cfg_ready)@(negedge sysclk);
    @(negedge sysclk); fast_oe=1;fast_ad=0;fast_as_n=0;fast_rd_n=1;fast_wr_n=1;fast_be_n=4'hf;
    @(negedge sysclk); fast_ad=addr;fast_be_n=0;
    @(negedge sysclk); fast_ad=value;fast_as_n=1;fast_wr_n=0;
    @(negedge sysclk); fast_oe=0;fast_wr_n=0;fast_rd_n=0;
   end else begin
    while(!req_ready)@(negedge sysclk);
    req_valid=1;req_addr=addr;req_data=value;
    @(negedge sysclk);req_valid=0;
    while(!rsp_valid)@(negedge sysclk);
    if(rsp_timeout || rsp_fault!=0)$fatal(1,"SYS transaction failed");
   end
  end
 endtask
 integer i;
 initial begin
  repeat(4)@(negedge sysclk);reset_n=1;
  // Begin as early as the real bus master permits: no artificial wait for FIFO.
  wr(32'h080103d4,32'h200);
  if(stop!=0)begin
   repeat(12)@(negedge sysclk);while(vidclk!==0)@(negedge sysclk);video_run=0;
   for(i=0;i<12;i=i+1)wr(32'h080103d4,32'h200);
   if(overflow==0 || !fifo_history_lost)$fatal(1,"expected retained loss indication after VIDEO stopped");
   video_run=1;
   repeat(80)@(negedge sysclk);
   if(received!=accepted || !fifo_history_lost)$fatal(1,"accepted events did not drain or loss flag vanished");
   $display("DEMONSTRATED LOSS: %0d PCRTC reset snapshots lost when VIDEO was stopped; sticky loss retained; %0d accepted drained",overflow,accepted);
   reset_n=0;#1;
   if(fifo_history_lost)$fatal(1,"board reset did not clear retained loss");
  end else begin
   // Continuous real bus writes under fast VBlank produce distinct captures.
   wr(32'h080103ac,32'h000003f9);wr(32'h080103b0,0);
   wr(32'h080103bc,1);wr(32'h080103c0,0);wr(32'h080103c4,0);
   wr(32'h080103cc,0);wr(32'h080103d0,32'h00200400);
   for(i=1;i<=256;i=i+1)wr(32'h08010354,i);
   // Identical consecutive software resets are separate transactions.
   for(i=0;i<32;i=i+1)wr(32'h080103d4,32'h200);
   // Repeatedly interleave reset with fresh fast VBlank timing and changed
   // display words. The direct stimulus uses the endpoint's four-phase
   // minimum; it is not a replacement for the real master path above.
   if(fast_endpoint) for(i=1;i<=32;i=i+1)begin
    wr(32'h080103ac,32'h000003f9);wr(32'h080103b0,0);
    wr(32'h080103bc,220);wr(32'h080103c0,0);wr(32'h080103c4,0);wr(32'h080103cc,0);
    wr(32'h080103d0,32'h00200400);wr(32'h08010354,i);
    wr(32'h080103d4,32'h200);
   end
   repeat(80)@(negedge sysclk);
   if(early || overflow || fifo_history_lost || sent!=received || reset_events<33 || sent<280 ||
      (fast_endpoint && (minspace!=4 || writes!=584 || reset_events<65 || adjacent_events==0)))
    $fatal(1,"events/overflow startup error early=%0d full=%0d sent=%0d recv=%0d reset=%0d",early,overflow,sent,received,reset_events);
   $display("PASS %s -> display CDC -> VIDEO, phase=%0d: %0d writes, min %0d clocks apart, %0d snapshots, %0d resets, %0d adjacent snapshot pairs; no FIFO stall; startup sequencer precedes first DATA",fast_endpoint ? "direct four-phase endpoint" : "real SYS master",phase,writes,minspace,sent,reset_events,adjacent_events);
  end
  $finish;
 end
 initial begin #1000000000;$fatal(1,"watchdog");end
endmodule
