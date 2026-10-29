`timescale 1ns/1ps
// Two independently pipelined scanout circuits share the real calendar and two
// physical 10 ns SRAM models. Expected pixels come from the actual TS scanout
// vectors, separately cross-checked against the actual C++ scanout owner.
module gfx_pcrtc_sample_pipeline_tb;
 reg clk=0;always #9.259259 clk=~clk;
 reg reset_n=0,power_reset_n=0;
 reg [1:0] req_valid=0,rsp_ready=0;wire [1:0] req_ready,rsp_valid;
 reg [31:0] req_disp[0:1],req_x[0:1],req_y[0:1];wire [31:0] rgba[0:1];
 wire [1:0] mem_valid,mem_ready,mem_rsp_valid,mem_rsp_ready;
 wire [18:0] mem_addr[0:1];wire [5:0] mem_tag[0:1];wire [31:0] mem_data_ret[0:1];wire [5:0] mem_tag_ret[0:1];
 wire [1:0] scan_ready,scan_valid;wire [63:0] scan_data;wire [15:0] scan_tag;
 wire [1:0] admitted_mem_valid;
 reg request_gate_open=1;
 wire [31:0] sram_data;wire [18:0] sram_addr;wire sram_ce_n,sram_oe_n,sram_we_n;wire [3:0] sram_be_n;
 reg renderer=0;wire render_ready,render_rsp_valid;integer render_completions=0;
 genvar c;generate for(c=0;c<2;c=c+1)begin:lane
  gfx_pcrtc_sample_pipeline #(.CIRCUIT2(c)) dut(.clk(clk),.reset_n(reset_n),
   .req_valid(req_valid[c]),.req_ready(req_ready[c]),.req_dispfb(req_disp[c]),.req_x(req_x[c]),.req_y(req_y[c]),
   .mem_req_valid(mem_valid[c]),.mem_req_ready(mem_ready[c]),.mem_req_address(mem_addr[c]),.mem_req_tag(mem_tag[c]),
   .mem_rsp_valid(mem_rsp_valid[c]),.mem_rsp_ready(mem_rsp_ready[c]),.mem_rsp_data(mem_data_ret[c]),.mem_rsp_tag(mem_tag_ret[c]),
   .rsp_valid(rsp_valid[c]),.rsp_ready(rsp_ready[c]),.rsp_rgba(rgba[c]));
  // Optional producer-side stall applies to both halves of the handshake:
  // a blocked request is not silently admitted by the actual scheduler.
  assign mem_ready[c]=scan_ready[c] && request_gate_open;
  assign admitted_mem_valid[c]=mem_valid[c] && request_gate_open;
  assign mem_rsp_valid[c]=scan_valid[c];
  assign mem_data_ret[c]=scan_data[c*32+:32];assign mem_tag_ret[c]=scan_tag[c*8+:6];
  issi_bll_pin_model #(.ADDRESS_WIDTH(19),.PATTERN(c==0?16'h5a5a:16'ha5a5)) ram(.address(sram_addr),.data(sram_data[c*16+:16]),
   .ce_n(sram_ce_n),.oe_n(sram_oe_n),.we_n(sram_we_n),.be_n(sram_be_n[c*2+:2]),.drive_active());
 end endgenerate
 gfx_memory_scheduler #(.TAG_WIDTH(8)) scheduler(.clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.quiesce(1'b0),.quiescent(),
  .scan_req_valid(admitted_mem_valid),.scan_req_ready(scan_ready),.scan_req_address({mem_addr[1],mem_addr[0]}),.scan_req_tag({2'b00,mem_tag[1],2'b00,mem_tag[0]}),
  .scan_rsp_valid(scan_valid),.scan_rsp_ready(mem_rsp_ready),.scan_rsp_data(scan_data),.scan_rsp_tag(scan_tag),
  .render_req_valid(renderer),.render_req_ready(render_ready),.render_req_write(1'b1),.render_req_address(19'h7ffff),.render_req_wdata(32'h13579bdf),
  .render_req_be_n(4'b0000),.render_req_tag(8'h34),.render_rsp_valid(render_rsp_valid),.render_rsp_ready(1'b1),.render_rsp_write(),.render_rsp_data(),.render_rsp_tag(),
  .mem_data(sram_data),.mem_address(sram_addr),.mem_ce_n(sram_ce_n),.mem_oe_n(sram_oe_n),.mem_we_n(sram_we_n),.mem_be_n(sram_be_n));
 reg [31:0] ds[0:1][0:4095],xs[0:1][0:4095],ys[0:1][0:4095],expected[0:1][0:4095];
 reg [18:0] expect_a[0:1][0:4095],expect_b[0:1][0:4095];
 integer expect_reads[0:1][0:4095];
 reg [18:0] slot_a[0:1][0:31],slot_b[0:1][0:31];
 integer slot_reads[0:1][0:31],slot_issued[0:1][0:31];
 reg [31:0] slot_live[0:1];
 integer total[0:1],sent[0:1],seen[0:1];integer f,n,rc,entries,circuit,need,mode=0,request_stall=0;
 reg [31:0] disp,x,y,a,b,out;integer cycles=0,source_stalls=0,response_stalls=0;
 integer output_last[0:1],max_gap[0:1],first_cycle[0:1],last_cycle[0:1],last_accept[0:1],hold_output=0,warm_reset=0,reset_done=0;
 reg [1:0] held_rsp=0,held_mem=0; reg [31:0] held_rgba[0:1];reg [18:0] held_addr[0:1];reg [5:0] held_tag[0:1];
 integer second_word_stalls=0,full_push_pop=0,head_wraps=0;
 always @(negedge clk) begin
  if(!reset_n) request_gate_open<=1;
  else request_gate_open<=!request_stall || cycles%23>=13;
 end
 initial begin
  if(!$value$plusargs("SATURATE=%d",mode))mode=0;
  if(!$value$plusargs("HOLD_OUTPUT=%d",hold_output))hold_output=0;
  if(!$value$plusargs("WARM_RESET=%d",warm_reset))warm_reset=0;
  if(!$value$plusargs("REQUEST_STALL=%d",request_stall))request_stall=0;
  total[0]=0;total[1]=0;sent[0]=0;sent[1]=0;seen[0]=0;seen[1]=0;
  slot_live[0]=0;slot_live[1]=0;
  last_accept[0]=0;last_accept[1]=0;output_last[0]=0;output_last[1]=0;max_gap[0]=0;max_gap[1]=0;first_cycle[0]=0;first_cycle[1]=0;last_cycle[0]=0;last_cycle[1]=0;
  f=$fopen("build/tests/gfx-pcrtc-sample-vectors.txt","r");if(!f)$fatal(1,"missing vectors");rc=$fscanf(f,"%d\n",entries);
  for(n=0;n<entries;n=n+1) begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h\n",circuit,disp,x,y,need,a,b,out);if(rc!=8)$fatal(1,"vector");
   // Renderer continuously writes the isolated last word. Exclude a read of
   // that word so expected data remain the actual TS/C++ initial SRAM image.
   if(a!=19'h7ffff && b!=19'h7ffff &&
      (!mode || ((circuit==0 && disp[19:15]==18) || (circuit==1 && disp[19:15]==0)))) begin
    ds[circuit][total[circuit]]=disp;xs[circuit][total[circuit]]=x;ys[circuit][total[circuit]]=y;expected[circuit][total[circuit]]=out;
    expect_a[circuit][total[circuit]]=a[18:0];expect_b[circuit][total[circuit]]=b[18:0];expect_reads[circuit][total[circuit]]=need;
    total[circuit]=total[circuit]+1;
   end
  end
  if(!mode && total[0]+total[1]!=entries)$fatal(1,"renderer address collides with a vector; no source may be silently omitted");
  if(mode && (total[0]<240||total[1]<240))$fatal(1,"too few saturated vectors %0d %0d",total[0],total[1]);
  repeat(3)@(negedge clk);power_reset_n=1;reset_n=1;repeat(5)@(negedge clk);renderer=1;
  while(seen[0]<total[0] || seen[1]<total[1]) begin
   @(negedge clk);
   if(warm_reset && !reset_done && sent[0]>=100 && sent[1]>=100 && (sent[0]>seen[0] || sent[1]>seen[1]))begin
    reset_n=0;req_valid=0;rsp_ready=0;renderer=0;held_rsp=0;held_mem=0;slot_live[0]=0;slot_live[1]=0;
    repeat(3)@(negedge clk);reset_n=1;sent[0]=0;sent[1]=0;seen[0]=0;seen[1]=0;
    last_accept[0]=0;last_accept[1]=0;output_last[0]=0;output_last[1]=0;reset_done=1;
    repeat(5)@(negedge clk);renderer=1;
   end
   for(integer l=0;l<2;l=l+1)begin
    if(!req_valid[l] && sent[l]<total[l] && cycles%4==0)begin
     req_valid[l]=1;req_disp[l]=ds[l][sent[l]];req_x[l]=xs[l][sent[l]];req_y[l]=ys[l][sent[l]];
    end
    // Periodic backpressure is applied in the correctness run. The saturation
    // run keeps consumers active and measures unimpeded producer admission.
    rsp_ready[l]=hold_output && cycles<300 ? 0 : mode ? (cycles>=64 && cycles%4==0) : (cycles%53<47);
   end
  end
  @(negedge clk);if(renderer && render_completions==0)$fatal(1,"no competing renderer writes");
  if(mode && source_stalls!=0)$fatal(1,"saturated source stalled %0d cycles",source_stalls);
  if(warm_reset && !reset_done)$fatal(1,"warm reset not exercised");
  if(hold_output && (source_stalls==0 || response_stalls==0))$fatal(1,"full queue/backpressure not exercised");
  if(request_stall && second_word_stalls==0)$fatal(1,"second GPU24 word was never stalled");
  if(request_stall && hold_output && (full_push_pop==0 || head_wraps==0))$fatal(1,"full-ring replacement or wrap was not exercised");
  $display("MEASURE mode=%0d lane0 %0d samples, lane1 %0d samples, source_stalls=%0d response_stalls=%0d renderer_writes=%0d max_output_gap=%0d/%0d",mode,total[0],total[1],source_stalls,response_stalls,render_completions,max_gap[0],max_gap[1]);
  $display("PASS pipelined PCRTC sample ordering and true scanout parity via two calendar lanes and SRAM pins");$finish;
 end
 always @(posedge clk) if(reset_n)begin
  cycles=cycles+1;
  if(mem_valid[0] && !mem_ready[0] && mem_tag[0][0])second_word_stalls=second_word_stalls+1;
  if(lane[0].dut.count==32 && lane[0].dut.push && lane[0].dut.pop)full_push_pop=full_push_pop+1;
  if(lane[0].dut.pop && lane[0].dut.head==31)head_wraps=head_wraps+1;
  if(renderer && render_rsp_valid)render_completions=render_completions+1;
  for(integer l=0;l<2;l=l+1)begin
   if(held_rsp[l] && (!rsp_valid[l] || rgba[l]!==held_rgba[l]))$fatal(1,"response changed during stall");
   held_rsp[l]=rsp_valid[l]&&!rsp_ready[l];held_rgba[l]=rgba[l];
   if(held_mem[l] && (!mem_valid[l] || mem_addr[l]!==held_addr[l] || mem_tag[l]!==held_tag[l]))$fatal(1,"memory request changed during stall");
   held_mem[l]=mem_valid[l]&&!mem_ready[l];held_addr[l]=mem_addr[l];held_tag[l]=mem_tag[l];
   if(req_valid[l]&&!req_ready[l])source_stalls=source_stalls+1;
   if(rsp_valid[l]&&!rsp_ready[l])response_stalls=response_stalls+1;
   if(mode && rsp_ready[l] && seen[l]<220 && !rsp_valid[l])$fatal(1,"steady output sample unavailable at four-clock boundary lane %0d cycle %0d",l,cycles);
   // Tags identify the reserved sample and word; compare every admitted SRAM
   // word address and its first/second order with the real TS/C++ oracle, not
   // only with an SRAM data pattern that could alias at two distinct addresses.
   if(mem_valid[l]&&mem_ready[l])begin
    if(!slot_live[l][mem_tag[l][5:1]])$fatal(1,"request for unreserved sample");
    if(slot_issued[l][mem_tag[l][5:1]]>=slot_reads[l][mem_tag[l][5:1]] ||
       mem_tag[l][0]!==slot_issued[l][mem_tag[l][5:1]][0] ||
       mem_addr[l]!==(mem_tag[l][0] ? slot_b[l][mem_tag[l][5:1]] : slot_a[l][mem_tag[l][5:1]]))
     $fatal(1,"lane %0d tag %h unexpected SRAM address/order %h",l,mem_tag[l],mem_addr[l]);
    slot_issued[l][mem_tag[l][5:1]]=slot_issued[l][mem_tag[l][5:1]]+1;
   end
   if(rsp_valid[l]&&rsp_ready[l])begin
    if(!slot_live[l][seen[l]&31] || slot_issued[l][seen[l]&31]!=slot_reads[l][seen[l]&31])
     $fatal(1,"lane %0d sample %0d missing/extra SRAM requests",l,seen[l]);
    slot_live[l][seen[l]&31]=0;
    if(seen[l]>=total[l] || rgba[l]!==expected[l][seen[l]])$fatal(1,"lane %0d sample %0d got %h expected %h",l,seen[l],rgba[l],expected[l][seen[l]]);
    if(output_last[l] && cycles-output_last[l]>max_gap[l])max_gap[l]=cycles-output_last[l];
    output_last[l]=cycles;if(first_cycle[l]==0)first_cycle[l]=cycles;last_cycle[l]=cycles;seen[l]=seen[l]+1;
   end
   if(req_valid[l]&&req_ready[l])begin
    if(mode && last_accept[l]!=0 && cycles-last_accept[l]!=4)$fatal(1,"input cadence lane %0d",l);
    if(slot_live[l][sent[l]&31])$fatal(1,"lane %0d reuses live sample slot",l);
    slot_live[l][sent[l]&31]=1;
    slot_a[l][sent[l]&31]=expect_a[l][sent[l]];slot_b[l][sent[l]&31]=expect_b[l][sent[l]];
    slot_reads[l][sent[l]&31]=expect_reads[l][sent[l]];slot_issued[l][sent[l]&31]=0;
    last_accept[l]=cycles;sent[l]=sent[l]+1;req_valid[l]<=0;
   end
  end
 end
 final if(request_stall)$display("COVER second_word_stalls=%0d full_push_pop=%0d head_wraps=%0d",second_word_stalls,full_push_pop,head_wraps);
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
