`timescale 1ns/1ps
// Cross-alignment PCM word assembly against exact TS/C++ decoder vectors.
// Word memory here is a clocked service, not the physical SRAM pin model.
module apu_pcm_frame_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0,req_valid=0,memory_req_ready=0,memory_rsp_valid=0,rsp_ready=0;
 reg [31:0] req_byte_address=0,req_channels=0,req_bits_per_sample=0,memory_rsp_word=0;
 wire req_ready,memory_req_valid,rsp_valid;wire [31:0] memory_req_address,rsp_samples;
 apu_pcm_frame dut(.*);
 reg [7:0] bytes[0:127];reg pending=0;reg [31:0] pending_addr=0;integer count=0,i,scan,f,case_count,n,reads,expected_reads;
 reg [31:0] addr,ch,bits,expected,held;
 string path="build/tests/apu-pcm-frame-vectors.txt";
 initial begin #3000000;$fatal(1,"watchdog case %0d",n);end
 always @(posedge clk) begin
  if(!reset_n)begin pending<=0;memory_rsp_valid<=0;memory_rsp_word<=0;end
  else begin
   memory_rsp_valid<=pending;pending<=0;
   if(pending) memory_rsp_word<={bytes[pending_addr+3],bytes[pending_addr+2],bytes[pending_addr+1],bytes[pending_addr]};
   if(memory_req_valid && memory_req_ready)begin
    if(memory_req_address[1:0]!=0)$fatal(1,"unaligned word request");
    pending_addr<=memory_req_address;pending<=1;reads<=reads+1;
   end
  end
 end
 initial begin
  for(i=0;i<128;i=i+1)bytes[i]=(i*73+91)&255;
  if($value$plusargs("VECTORS=%s",path))begin end
  f=$fopen(path,"r");if(f==0)$fatal(1,"cannot open vectors");
  scan=$fscanf(f,"%d",case_count);if(scan!=1)$fatal(1,"missing count");
  repeat(3) @(negedge clk);reset_n=1;
  for(n=0;n<case_count;n=n+1) begin
   scan=$fscanf(f,"%h %h %h %h",addr,ch,bits,expected);if(scan!=4)$fatal(1,"missing vector");
   @(negedge clk);while(!req_ready)@(negedge clk);
   req_byte_address=addr;req_channels=ch;req_bits_per_sample=bits;req_valid=1;reads=0;
   @(negedge clk);req_valid=0;memory_req_ready=0;
   repeat(n%3) @(negedge clk);memory_req_ready=1;
   while(!rsp_valid)@(negedge clk);
   if(rsp_samples!==expected)$fatal(1,"case %0d address=%h channels=%h bits=%h expected=%h got=%h",n,addr,ch,bits,expected,rsp_samples);
   expected_reads=((addr&3)+(bits==16 ? (ch==1 ? 2:4):(ch==1 ? 1:2))>4) ? 2:1;
   if(reads!=expected_reads)$fatal(1,"case %0d expected %0d word requests, got %0d",n,expected_reads,reads);
   held=rsp_samples;repeat(2)begin @(negedge clk);if(!rsp_valid || rsp_samples!==held || req_ready)$fatal(1,"response backpressure");end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  $fclose(f);
  $display("PASS %0d PCM frames vs TS/C++, all byte alignments, mono/stereo/raw format words and backpressure",case_count);$finish;
 end
endmodule
