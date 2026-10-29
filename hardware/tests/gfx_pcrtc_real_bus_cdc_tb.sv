`timescale 1ps/1ps
// Actual CORE packet master -> PCRTC endpoint/control -> asynchronous FIFO ->
// display epoch. Common global reset feeds all domains. The source's local
// reset is released after the FIFO write pointer's own two SYS release flops;
// the real master cannot deliver its first DATA beat during that interval.
// No ready is fed back from the FIFO to PCRTC. Clock availability, supervisor
// restoration, FIFO capacity beyond exercised traffic, FIELD, memory reads and
// the DAC deadline are not established by this integration experiment.
// +STOP=1 stops VIDEO after startup and demonstrates actual update loss rather
// than calling an overflowing queue a safe design.
module gfx_pcrtc_real_bus_cdc_tb;
 reg sysclk=0,vidclk=0,reset_n=0,video_run=1;
 integer phase=0,stop=0,sys_half_ps=14763,video_half_ps=37037;
 initial begin
  if($value$plusargs("SYS_HALF=%d",sys_half_ps)) begin end
  forever begin #(sys_half_ps);sysclk=~sysclk;end
 end
 initial begin
  if($value$plusargs("PHASE=%d",phase)) begin end
  if($value$plusargs("STOP=%d",stop)) begin end
  if($value$plusargs("VIDEO_HALF=%d",video_half_ps)) begin end
  #(phase); forever begin #(video_half_ps);if(video_run)vidclk=~vidclk; end
 end
 reg [2:0] local_release=0;
 always @(posedge sysclk or negedge reset_n)
  if(!reset_n)local_release<=0;else local_release<={local_release[1:0],1'b1};
 wire source_reset_n=reset_n && local_release[2];
 reg req_valid=0; reg [31:0] req_addr=0,req_data=0;
 wire req_ready,rsp_valid,rsp_timeout,busy;
 wire [31:0] rsp_data,rsp_fault,master_out,endpoint_out;
 wire master_oe,endpoint_oe,ready_low,as_n,rd_n,wr_n;
 wire [3:0] be_n;
 tri [31:0] ad;tri1 ready_n;
 assign ad=master_oe ? master_out : 32'bz;
 assign ad=endpoint_oe ? endpoint_out : 32'bz;
 assign ready_n=ready_low ? 1'b0 : 1'bz;
 system_bus_master master(.clk(sysclk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(1'b1),.req_addr(req_addr),.req_wdata(req_data),.req_be_n(4'd0),
  .req_header_be_n(4'hf),.bus_busy(busy),.req_meta(32'd0),.req_data_timeout_enable(1'b0),
  .req_data_wait_last(18'd0),.rsp_valid(rsp_valid),.rsp_rdata(rsp_data),.rsp_fault_code(rsp_fault),
  .rsp_timeout(rsp_timeout),.bus_ad_in(ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),
  .bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ready_n(ready_n));
 wire cfg_valid,cfg_write;wire [4:0] cfg_index;wire [31:0] cfg_data,cfg_rdata;
 gfx_pcrtc_sys_endpoint endpoint(.clk(sysclk),.reset_n(reset_n),.cs_pcrtc_n(!busy),
  .bus_ad_in(ad),.bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),
  .bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),.bus_ready_drive_low(ready_low),
  .config_valid(cfg_valid),.config_write(cfg_write),.config_index(cfg_index),.config_write_word(cfg_data),
  .config_ready(1'b1),.config_read_word(cfg_rdata));
 wire [703:0] programmed,displayed,update_words,video_words;
 wire update_valid,update_reset,fifo_ready,out_valid;
 wire [704:0] out_data;
 gfx_pcrtc_control source(.clk(sysclk),.reset_n(source_reset_n),
  .access_valid(cfg_valid),.access_write(cfg_write),.access_index(cfg_index),.access_wdata(cfg_data),.access_rdata(cfg_rdata),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),
  .programmed_words(programmed),.displayed_words(displayed),.display_update_valid(update_valid),
  .display_update_reset(update_reset),.display_update_words(update_words),
  .timing_restart(),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(),.imr_word());
 async_fifo #(.WIDTH(705),.ADDR_BITS(2)) fifo(.reset_n(reset_n),.w_clk(sysclk),
  .w_valid(update_valid),.w_ready(fifo_ready),.w_data({update_reset,update_words}),
  .r_clk(vidclk),.r_valid(out_valid),.r_ready(1'b1),.r_data(out_data));
 gfx_pcrtc_display_epoch sink(.clk(vidclk),.reset_n(reset_n),.update_valid(out_valid),
  .update_reset(out_data[704]),.update_words(out_data[703:0]),.display_words(video_words),
  .running(),.sample_valid(),.period_numerator(),.phase(),.field_half_line(),
  .elapsed_half_lines(),.local_field(),.vblank_active(),.output_x());
 reg [704:0] expected[0:2047];
 integer sent=0,accepted=0,received=0,overflow=0,reset_events=0,writes=0,early=0;
 integer cycle=0,lastwrite=-1000,minspace=1000;
 reg check_latch=0,check_output=0; reg [703:0] last_update,last_output;
 always @(posedge sysclk) if(reset_n) begin
  cycle=cycle+1;
  if(master_oe && endpoint_oe)$fatal(1,"bus contention");
  if(cfg_valid && cfg_write)begin
   writes=writes+1;
   if(!source_reset_n)early=early+1;
   if(cycle-lastwrite<minspace)minspace=cycle-lastwrite;
   lastwrite=cycle;
  end
  if(update_valid)begin
   sent=sent+1;
   if(update_reset)reset_events=reset_events+1;
   check_latch=1;last_update=update_words;
   if(fifo_ready)begin expected[accepted]={update_reset,update_words};accepted=accepted+1;end
   else overflow=overflow+1;
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
   while(!req_ready)@(negedge sysclk);
   req_valid=1;req_addr=addr;req_data=value;
   @(negedge sysclk);req_valid=0;
   while(!rsp_valid)@(negedge sysclk);
   if(rsp_timeout || rsp_fault!=0)$fatal(1,"SYS transaction failed");
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
   if(overflow==0)$fatal(1,"expected actual full FIFO after VIDEO stopped");
   video_run=1;
   repeat(80)@(negedge sysclk);
   if(received!=accepted)$fatal(1,"accepted events did not drain");
   $display("DEMONSTRATED LOSS: %0d PCRTC reset snapshots lost when VIDEO was stopped; no write backpressure; %0d accepted drained",overflow,accepted);
  end else begin
   // Continuous real bus writes under fast VBlank produce distinct captures.
   wr(32'h080103ac,32'h000003f9);wr(32'h080103b0,0);
   wr(32'h080103bc,1);wr(32'h080103c0,0);wr(32'h080103c4,0);
   wr(32'h080103cc,0);wr(32'h080103d0,32'h00200400);
   for(i=1;i<=256;i=i+1)wr(32'h08010354,i);
   // Identical consecutive software resets are separate transactions.
   for(i=0;i<32;i=i+1)wr(32'h080103d4,32'h200);
   repeat(80)@(negedge sysclk);
   if(early || overflow || sent!=received || reset_events<33 || sent<280)
    $fatal(1,"events/overflow startup error early=%0d full=%0d sent=%0d recv=%0d reset=%0d",early,overflow,sent,received,reset_events);
   $display("PASS real SYS -> display CDC -> VIDEO, phase=%0d: %0d writes, min %0d clocks apart, %0d snapshots, %0d resets; no FIFO stall; local release precedes first DATA",phase,writes,minspace,sent,reset_events);
  end
  $finish;
 end
 initial begin #1000000000;$fatal(1,"watchdog");end
endmodule
