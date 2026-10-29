`timescale 1ns/1ps
module imgdec_stream_batched_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,stream_start=0,permit=0,input_write_valid=0,input_finished=0,output_ready=0;
 reg [31:0] texture_destination=32'hfedc1234,texture_size=32'h12345678,clut_destination=32'h8080abcd,input_write_word=0;
 wire input_write_ready,output_valid,production_complete,format_fault;
 wire [31:0] output_word,decoded_words,expected_output_words;wire [5:0] input_occupancy;wire [6:0] output_occupancy;
 imgdec_stream_batched dut(.*);
 reg [31:0] input_words[0:11],gold[0:99];integer received=0,gold_count=0,f,rc;
 always @(posedge clk) if(reset_n && output_valid && output_ready) begin
  if(received>=gold_count || output_word!==gold[received])
   $fatal(1,"output %0d got %h expected %h",received,output_word,gold[received]);
  received=received+1;
 end
 task automatic put(input [31:0] value);
  begin @(negedge clk);input_write_word=value;input_write_valid=1;
   @(posedge clk);while(!input_write_ready)@(posedge clk);
   @(negedge clk);input_write_valid=0;end
 endtask
 task automatic start;
  begin @(negedge clk);stream_start=1;input_write_valid=0;input_finished=0;output_ready=0;permit=0;
   @(negedge clk);stream_start=0;received=0;end
 endtask
 task automatic header(input [31:0] t,input [31:0] c);
  begin put(32'h31444d49);put(t);put(c);end
 endtask
 initial begin
  $readmemh("tests/imgdec_payload_vectors.hex",input_words);
  f=$fopen("build/tests/imgdec_stream_reference_ts.txt","r");if(!f)$fatal(1,"missing packet reference");
  for(integer n=0;n<29;n=n+1) begin rc=$fscanf(f,"%h",gold[n]);if(rc!=1)$fatal(1,"reference word %0d",n);end
  $fclose(f);gold_count=29;
  repeat(3)@(negedge clk);reset_n=1;start();
  header(3,20);for(integer n=0;n<12;n=n+1)put(input_words[n]);
  @(negedge clk);input_finished=1;permit=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || output_occupancy!=29 || decoded_words!=23 || input_occupancy!=0)$fatal(1,"reference packet");
  output_ready=1;wait(received==29);@(negedge clk);output_ready=0;
  // Partial literal input: stage seven words without freeing them or changing
  // the visible decoded counter. Pausing cannot publish the staged prefix.
  start();gold_count=21;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  for(integer n=0;n<18;n=n+1)gold[n+3]=32'h12340000+n;
  header(18,0);put(17);for(integer n=0;n<7;n=n+1)put(32'h12340000+n);
  @(negedge clk);permit=1;wait(dut.batch_state==1 && dut.batch_size==7 && dut.batch_index==2);
  @(negedge clk);permit=0;repeat(3)@(negedge clk);
  if(input_occupancy!=7 || output_occupancy!=3 || decoded_words!=0)$fatal(1,"partial literal published or freed before commit");
  // Additional input arrives while the selected prefix remains reserved.
  put(32'h12340007);put(32'h12340008);
  permit=1;wait(dut.batch_state==2);
  @(negedge clk);input_write_word=32'h12340009;input_write_valid=1;
  @(posedge clk);if(!input_write_ready)$fatal(1,"input unexpectedly full on batch commit");
  @(negedge clk);input_write_valid=0;permit=0;
  if(decoded_words!=7 || input_occupancy!=3 || output_occupancy!=10)$fatal(1,"seven-word commit with simultaneous input");
  for(integer n=10;n<18;n=n+1)put(32'h12340000+n);
  @(negedge clk);input_finished=1;permit=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || decoded_words!=18 || input_occupancy!=0 || output_occupancy!=21)$fatal(1,"literal suffix");
  output_ready=1;wait(received==21);@(negedge clk);output_ready=0;
  // A single long run is published as exactly 16, 16 and 8 words.
  start();header(40,0);put(32'hc0000027);@(negedge clk);input_finished=1;permit=1;
  wait(decoded_words==16);@(negedge clk);if(output_occupancy!=19)$fatal(1,"first 16-word commit");
  wait(decoded_words==32);@(negedge clk);if(output_occupancy!=35)$fatal(1,"second 16-word commit");
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || decoded_words!=40 || output_occupancy!=43)$fatal(1,"final 8-word commit");
  // Invalid back-reference leaves the atomic three-word header readable.
  start();header(3,0);put(32'h80000000);@(negedge clk);input_finished=1;permit=1;
  wait(format_fault);@(negedge clk);
  if(decoded_words!=0 || output_occupancy!=3)$fatal(1,"bad back-reference retained output");
  // Overlong zero run publishes its allowed prefix then faults, without rollback.
  start();header(2,0);put(32'hc0000002);@(negedge clk);input_finished=1;permit=1;
  wait(format_fault);@(negedge clk);
  if(decoded_words!=2 || output_occupancy!=5)$fatal(1,"overlong run prefix");
  // Literal exhaustion publishes the complete available prefix before fault.
  start();header(2,0);put(1);put(32'h12345678);@(negedge clk);input_finished=1;permit=1;
  wait(format_fault);@(negedge clk);
  if(decoded_words!=1 || output_occupancy!=4)$fatal(1,"literal exhausted prefix");
  // Long repeat crosses CLUT; its header waits with only two free slots.
  start();gold_count=66;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  for(integer i=3;i<62;i=i+1)gold[i]=32'h55667788;
  gold[62]=32'ha0000000;gold[63]=clut_destination;gold[64]=32'h00010010;gold[65]=32'h55667788;
  header(59,1);put(32'h4000003b);put(32'h55667788);@(negedge clk);input_finished=1;permit=1;
  wait(output_occupancy==62 && decoded_words==59);repeat(4)@(negedge clk);
  if(output_occupancy!=62 || format_fault || production_complete)$fatal(1,"CLUT header at two free");
  output_ready=1;@(negedge clk);output_ready=0;wait(output_occupancy==64);repeat(3)@(negedge clk);
  if(decoded_words!=59 || format_fault)$fatal(1,"CLUT full stall");
  output_ready=1;wait(production_complete || format_fault);wait(received==66);@(negedge clk);output_ready=0;
  if(format_fault || output_occupancy!=0 || decoded_words!=60)$fatal(1,"CLUT cross-boundary queue result");
  // A distance-one overlapping back-reference spans the two packets. The
  // history read begun at the texture endpoint must survive the intervening
  // atomic CLUT header without losing or duplicating a payload word.
  start();gold_count=14;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  for(integer i=3;i<7;i=i+1)gold[i]=32'h0123abcd;
  gold[7]=32'ha0000000;gold[8]=clut_destination;gold[9]=32'h00010010;
  for(integer i=10;i<14;i=i+1)gold[i]=32'h0123abcd;
  header(4,4);put(0);put(32'h0123abcd);put(32'h80004000);
  @(negedge clk);input_finished=1;permit=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || decoded_words!=8 || input_occupancy!=0 || output_occupancy!=14)
   $fatal(1,"overlapping back-reference across CLUT");
  output_ready=1;wait(received==14);@(negedge clk);output_ready=0;
  // A single literal token also spans the boundary: the input pointer must
  // advance only at each batch commit, not at the generated CLUT header.
  start();gold_count=12;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  for(integer i=0;i<3;i=i+1)gold[i+3]=32'hbead0000+i;
  gold[6]=32'ha0000000;gold[7]=clut_destination;gold[8]=32'h00010010;
  for(integer i=0;i<3;i=i+1)gold[i+9]=32'hbead0003+i;
  header(3,3);put(5);for(integer i=0;i<6;i=i+1)put(32'hbead0000+i);
  @(negedge clk);input_finished=1;permit=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || decoded_words!=6 || input_occupancy!=0 || output_occupancy!=12)
   $fatal(1,"literal across CLUT");
  output_ready=1;wait(received==12);@(negedge clk);output_ready=0;
  $display("PASS IMGDEC batch owner: TS/C++ packet, literal reservation and atomic commit, pause, faults, literal/back-reference CLUT boundaries and output-full stall");
  $finish;
 end
 initial begin #3000000;$fatal(1,"batched stream watchdog");end
endmodule
