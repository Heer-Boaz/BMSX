`timescale 1ns/1ps
module imgdec_stream_queued_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,stream_start=0,permit=1,input_valid=0,input_exhausted=0,output_ready=0;
 reg [31:0] texture_destination=32'hfedc1234,texture_size=32'h12345678,clut_destination=32'h8080abcd,input_word=0;
 wire input_ready,output_valid,production_complete,format_fault;
 wire [31:0] output_word,decoded_words,expected_output_words;wire [6:0] output_occupancy;
 imgdec_stream_queued dut(.*);
 reg [31:0] input_words[0:11],gold[0:99];integer received=0,gold_count=0,f,rc;
 always @(posedge clk) if(reset_n && output_valid && output_ready) begin
  if(received>=gold_count || output_word!==gold[received])
   $fatal(1,"output %0d got %h expected %h",received,output_word,gold[received]);
  received=received+1;
 end
 task automatic send(input [31:0] value);
  begin @(negedge clk);input_word=value;input_valid=1;@(posedge clk);while(!input_ready)@(posedge clk);@(negedge clk);input_valid=0;end
 endtask
 task automatic start;
  begin @(negedge clk);stream_start=1;input_valid=0;input_exhausted=0;output_ready=0;
   @(negedge clk);stream_start=0;received=0;end
 endtask
 initial begin
  $readmemh("tests/imgdec_payload_vectors.hex",input_words);
  f=$fopen("build/tests/imgdec_stream_reference_ts.txt","r");if(!f)$fatal(1,"missing packet reference");
  for(integer n=0;n<29;n=n+1) begin rc=$fscanf(f,"%h",gold[n]);if(rc!=1)$fatal(1,"reference word %0d",n);end
  $fclose(f);gold_count=29;
  repeat(3)@(negedge clk);reset_n=1;start();
  send(32'h31444d49);send(3);send(20);
  for(integer n=0;n<12;n=n+1)send(input_words[n]);
  @(negedge clk);input_exhausted=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || output_occupancy!=29 || decoded_words!=23)$fatal(1,"queued packet production");
  output_ready=1;wait(received==29);@(negedge clk);output_ready=0;
  if(output_occupancy!=0)$fatal(1,"packet not drained");
  // A 60-word repeat crosses texture-to-CLUT with the FIFO at 62 words.
  // The CLUT header cannot appear with only two free slots. Reading one
  // permits the complete header on the next clock; the payload then waits.
  start();gold_count=66;
  gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  for(integer i=3;i<62;i=i+1)gold[i]=32'h55667788;
  gold[62]=32'ha0000000;gold[63]=clut_destination;gold[64]=32'h00010010;gold[65]=32'h55667788;
  send(32'h31444d49);send(59);send(1);send(32'h4000003b);send(32'h55667788);
  @(negedge clk);input_exhausted=1;
  wait(output_occupancy==62 && decoded_words==59);repeat(4)@(negedge clk);
  if(output_occupancy!=62 || format_fault || production_complete)$fatal(1,"CLUT header not held at two free");
  output_ready=1;@(negedge clk);output_ready=0;
  wait(output_occupancy==64);repeat(3)@(negedge clk);
  if(decoded_words!=59 || format_fault)$fatal(1,"CLUT payload did not wait for space");
  output_ready=1;wait(production_complete || format_fault);wait(received==66);@(negedge clk);output_ready=0;
  if(format_fault || output_occupancy!=0 || decoded_words!=60 || expected_output_words!=66)
   $fatal(1,"CLUT cross-boundary queue result");
  $display("PASS IMGDEC stream + FIFO: TS/C++ packet and atomic CLUT header at two/three free slots, full-stall and ordered drain");
  $finish;
 end
 initial begin #1000000;$fatal(1,"queued stream watchdog");end
endmodule
