`timescale 1ns/1ps
// Both actual PCRTC pipelines -> tagged SRAM scheduler -> compositor. Expected
// pixels come from real TS and C++ scanout owners; images use the existing
// two physical ISSI pin models. No beam/CDC or overlapping renderer writes.
module gfx_pcrtc_join_tb;
 reg clk=0;always #9.259259 clk=~clk;
 reg reset_n=0,power_reset_n=0,req_valid=0,rsp_ready=0;
 reg [31:0] req_tag=0,pm=0,bg=0,d1=0,x1=0,y1=0,d2=0,x2=0,y2=0;reg in1=0,in2=0;
 wire req_ready,rsp_valid;wire [31:0] rsp_tag,rsp_rgba;
 wire [1:0] mem_req_valid,mem_req_ready,mem_rsp_valid,mem_rsp_ready;
 wire [37:0] mem_addr;wire [11:0] mem_tag;wire [63:0] mem_data;wire [11:0] mem_rsp_tag;
 wire [1:0] scan_req_valid,scan_req_ready,scan_rsp_valid;wire [63:0] scan_rsp_data;wire [15:0] scan_rsp_tag;
 wire [31:0] sram_data;wire [18:0] sram_addr;wire sram_ce_n,sram_oe_n,sram_we_n;wire [3:0] sram_be_n;
 reg [1:0] gate=2'b11;reg renderer=0;wire render_ready,render_rsp_valid;
 assign scan_req_valid=mem_req_valid & gate;assign mem_req_ready=scan_req_ready & gate;
 assign mem_rsp_valid=scan_rsp_valid;assign mem_data=scan_rsp_data;assign mem_rsp_tag={scan_rsp_tag[13:8],scan_rsp_tag[5:0]};
 gfx_pcrtc_join dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_tag(req_tag),
  .req_pmode(pm),.req_bgcolor(bg),.req_c1_inside(in1),.req_c2_inside(in2),
  .req_c1_dispfb(d1),.req_c1_x(x1),.req_c1_y(y1),.req_c2_dispfb(d2),.req_c2_x(x2),.req_c2_y(y2),
  .mem_req_valid(mem_req_valid),.mem_req_ready(mem_req_ready),.mem_req_address(mem_addr),.mem_req_tag(mem_tag),
  .mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_data),.mem_rsp_tag(mem_rsp_tag),
  .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_tag(rsp_tag),.rsp_rgba(rsp_rgba));
 gfx_memory_scheduler #(.TAG_WIDTH(8)) scheduler(.clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.quiesce(1'b0),.quiescent(),
  .scan_req_valid(scan_req_valid),.scan_req_ready(scan_req_ready),.scan_req_address(mem_addr),.scan_req_tag({2'b00,mem_tag[11:6],2'b00,mem_tag[5:0]}),
  .scan_rsp_valid(scan_rsp_valid),.scan_rsp_ready(mem_rsp_ready),.scan_rsp_data(scan_rsp_data),.scan_rsp_tag(scan_rsp_tag),
  .render_req_valid(renderer),.render_req_ready(render_ready),.render_req_write(1'b1),.render_req_address(19'h7ffff),.render_req_wdata(32'h13579bdf),
  .render_req_be_n(4'b0000),.render_req_tag(8'h34),.render_rsp_valid(render_rsp_valid),.render_rsp_ready(1'b1),.render_rsp_write(),.render_rsp_data(),.render_rsp_tag(),
  .mem_data(sram_data),.mem_address(sram_addr),.mem_ce_n(sram_ce_n),.mem_oe_n(sram_oe_n),.mem_we_n(sram_we_n),.mem_be_n(sram_be_n));
 genvar c;generate for(c=0;c<2;c=c+1)begin:part
  issi_bll_pin_model #(.ADDRESS_WIDTH(19),.PATTERN(c==0?16'h5a5a:16'ha5a5)) ram(.address(sram_addr),.data(sram_data[c*16+:16]),
   .ce_n(sram_ce_n),.oe_n(sram_oe_n),.we_n(sram_we_n),.be_n(sram_be_n[c*2+:2]),.drive_active());
 end endgenerate
 reg [31:0] vtag[0:2047],vpm[0:2047],vbg[0:2047],vi1[0:2047],vi2[0:2047],vd1[0:2047],vx1[0:2047],vy1[0:2047],vp1[0:2047],vd2[0:2047],vx2[0:2047],vy2[0:2047],vp2[0:2047],expected[0:2047];
 integer n,rc,f,count,sent=0,received=0,cycles=0,mode=0,stall=0,hold=0,warm=0,reset_done=0;
 integer req_stall=0,rsp_stall=0,renderer_writes=0,last_accept=0,last_output=0,max_gap=0,accepted_reads[0:1],actual_reads[0:1],elided_reads=0;
 integer full_push_pop=0,head_wraps=0,skewed_join=0;
 reg [3:0] lane_mask_seen=0;
 reg held=0;reg [31:0] held_tag,held_rgba;reg [1:0] mem_held=0;reg [18:0] held_addr[0:1];reg [5:0] held_mem_tag[0:1];
 function automatic integer words(input [4:0] p,input bit circuit2);
  begin if(p==0||p==1||p==2||p==10||p==31)words=1;else if(p==18&&!circuit2)words=2;else words=0;end
 endfunction
 always @(negedge clk) begin
  if(!reset_n)gate<=2'b11;else if(stall) begin gate[0]<=cycles%23>=13;gate[1]<=cycles%17>=6;end else gate<=2'b11;
 end
 initial begin
  if(!$value$plusargs("SATURATE=%d",mode))mode=0;
  if(!$value$plusargs("REQUEST_STALL=%d",stall))stall=0;
  if(!$value$plusargs("HOLD_OUTPUT=%d",hold))hold=0;
  if(!$value$plusargs("WARM_RESET=%d",warm))warm=0;
  if(mode)f=$fopen("build/tests/gfx-pcrtc-join-saturate.txt","r");else f=$fopen("build/tests/gfx-pcrtc-join-vectors.txt","r");
  if(!f)$fatal(1,"missing vectors");rc=$fscanf(f,"%d\n",count);
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",vtag[n],vpm[n],vbg[n],vi1[n],vi2[n],vd1[n],vx1[n],vy1[n],vp1[n],vd2[n],vx2[n],vy2[n],vp2[n],expected[n]);if(rc!=14)$fatal(1,"bad vector");
  end
  accepted_reads[0]=0;accepted_reads[1]=0;actual_reads[0]=0;actual_reads[1]=0;
  repeat(3)@(negedge clk);power_reset_n=1;reset_n=1;repeat(5)@(negedge clk);renderer=1;
  while(received<count)begin
   @(negedge clk);
   if(warm && !reset_done && sent>=100 && sent>received) begin
    reset_n=0;req_valid=0;rsp_ready=0;renderer=0;held=0;mem_held=0;
    repeat(3)@(negedge clk);reset_n=1;sent=0;received=0;last_accept=0;last_output=0;
    accepted_reads[0]=0;accepted_reads[1]=0;actual_reads[0]=0;actual_reads[1]=0;reset_done=1;
    repeat(5)@(negedge clk);renderer=1;
   end
   if(!req_valid && sent<count && cycles%4==0) begin
    req_valid=1;req_tag=vtag[sent];pm=vpm[sent];bg=vbg[sent];in1=vi1[sent];in2=vi2[sent];
    d1=vd1[sent];x1=vx1[sent];y1=vy1[sent];d2=vd2[sent];x2=vx2[sent];y2=vy2[sent];
   end
   rsp_ready=hold && cycles<400 ? 0 : mode ? (cycles>=96 && cycles%4==0) : (cycles%53<41);
  end
  @(negedge clk);
  if(accepted_reads[0]!=actual_reads[0] || accepted_reads[1]!=actual_reads[1])$fatal(1,"read count expected %0d/%0d got %0d/%0d",accepted_reads[0],accepted_reads[1],actual_reads[0],actual_reads[1]);
  if(mode && (req_stall!=0 || max_gap>4))$fatal(1,"steady stream stalled/gap %0d/%0d",req_stall,max_gap);
  if(stall && req_stall==0)$fatal(1,"expected request backpressure");
  if(hold && (req_stall==0||rsp_stall==0))$fatal(1,"output/backpressure not exercised");
  if(hold && (full_push_pop==0 || head_wraps==0))$fatal(1,"ordered join full replacement/wrap not exercised");
  if(!mode && lane_mask_seen!==4'b1111)$fatal(1,"circuit use masks not covered: %b",lane_mask_seen);
  if(!mode && elided_reads==0)$fatal(1,"transparent fixed-alpha read elision not exercised");
  if(!mode && skewed_join==0)$fatal(1,"independent lane arrival not exercised");
  if(warm && !reset_done)$fatal(1,"warm reset not exercised");
  if(!renderer_writes)$fatal(1,"renderer did not write");
  $display("MEASURE joined mode=%0d samples=%0d producer_stalls=%0d output_stalls=%0d max_gap=%0d renderer_writes=%0d reads=%0d/%0d",mode,count,req_stall,rsp_stall,max_gap,renderer_writes,actual_reads[0],actual_reads[1]);
  $display("PASS joined scanout: exact sequence/controls, independent lane latency, windows, PMODE and two real SRAM scheduler lanes");$finish;
 end
 always @(posedge clk)if(reset_n)begin
  cycles=cycles+1;
  if(dut.count==32 && dut.push && dut.consume)full_push_pop=full_push_pop+1;
  if(dut.consume && dut.head==31)head_wraps=head_wraps+1;
  if(dut.count!=0 && dut.needed1[dut.head] && dut.needed2[dut.head] && dut.lane_rsp_valid==2'b01)skewed_join=skewed_join+1;
  if(dut.count!=0 && dut.needed1[dut.head] && dut.needed2[dut.head] && dut.lane_rsp_valid==2'b10)skewed_join=skewed_join+1;
  if(renderer&&render_rsp_valid)renderer_writes=renderer_writes+1;
  if(held && (!rsp_valid||rsp_tag!==held_tag||rsp_rgba!==held_rgba))$fatal(1,"output changed during stall");
  held=rsp_valid&&!rsp_ready;held_tag=rsp_tag;held_rgba=rsp_rgba;
  for(integer l=0;l<2;l=l+1)begin
   if(mem_held[l] && (!mem_req_valid[l]||mem_addr[l*19+:19]!==held_addr[l]||mem_tag[l*6+:6]!==held_mem_tag[l]))$fatal(1,"memory request changed during stall");
   mem_held[l]=mem_req_valid[l]&&!mem_req_ready[l];held_addr[l]=mem_addr[l*19+:19];held_mem_tag[l]=mem_tag[l*6+:6];
   if(mem_req_valid[l]&&mem_req_ready[l])actual_reads[l]=actual_reads[l]+1;
  end
  if(req_valid&&!req_ready)req_stall=req_stall+1;
  if(rsp_valid&&!rsp_ready)rsp_stall=rsp_stall+1;
  if(req_valid&&req_ready)begin
   lane_mask_seen[{dut.need2,dut.need1}]=1;
   if(mode&&last_accept!=0&&cycles-last_accept!=4)$fatal(1,"input cadence %0d",cycles-last_accept);
   if(pm[0]&&in1&&!(pm[5]&&pm[6]&&pm[15:8]==0))accepted_reads[0]=accepted_reads[0]+words(d1[19:15],0);
   if(pm[0]&&in1&&pm[5]&&pm[6]&&pm[15:8]==0)elided_reads=elided_reads+1;
   if(pm[1]&&in2&&(!pm[7]||pm[6]))accepted_reads[1]=accepted_reads[1]+words(d2[19:15],1);
   last_accept=cycles;sent=sent+1;req_valid<=0;
  end
  if(mode && cycles>=96 && cycles%4==0 && received<220 && !rsp_valid)$fatal(1,"deadline after priming %0d",cycles);
  if(rsp_valid&&rsp_ready)begin
   if(rsp_tag!==vtag[received] || rsp_rgba!==expected[received])$fatal(1,"pixel %0d tag %h/%h rgba %h/%h",received,rsp_tag,vtag[received],rsp_rgba,expected[received]);
   if(last_output && cycles-last_output>max_gap)max_gap=cycles-last_output;
   last_output=cycles;received=received+1;
  end
 end
 final $display("COVER join full_push_pop=%0d head_wraps=%0d unequal_lane_arrival=%0d lane_masks=%b transparent_elisions=%0d",full_push_pop,head_wraps,skewed_join,lane_mask_seen,elided_reads);
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
