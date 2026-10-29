`timescale 1ns/1ps
module core_ram_scalar_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg power_reset_n=1,reset_n=1,req_valid=0,req_write=0;
    reg [31:0] req_address=0,req_wdata=0;
    reg [2:0] req_size_bytes=4;
    wire req_ready,rsp_valid,init_done;
    wire [31:0] rsp_rdata,rsp_fault_code;
    wire [9:0] ma;
    tri [31:0] md;
    wire ras_n,we_n,oe_n;
    wire [3:0] cas_n;
    core_ram_scalar dut(.req_private(1'b0),.ras_private_n(),.oe_private_n(),.*);
    is41lv16100_pair_model memory(.*);
    reg [7:0] expected[0:15];
    integer operations=0;
    task automatic tick; @(posedge clk);#1; endtask
    task automatic transfer(input bit write_enable,input [31:0] address,
                            input [2:0] bytes,input [31:0] value,
                            output reg [31:0] result, fault);
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=write_enable;req_address=address;
        req_size_bytes=bytes;req_wdata=value;
        tick();@(negedge clk);req_valid=0;
        // Verify request was captured rather than observing changing producer data.
        req_address=~address;req_wdata=~value;req_size_bytes=1;req_write=!write_enable;
        while(!rsp_valid) tick();
        result=rsp_rdata;fault=rsp_fault_code;operations=operations+1;
    endtask
    reg [31:0] got,fault,want;
    integer initial_writes,initial_reads;
    initial begin
        #2;power_reset_n=0;reset_n=0;#137;power_reset_n=1;
        while(!init_done) tick();
        #3;reset_n=1;
        for(integer offset=0;offset<4;offset=offset+1) begin
            for(integer kind=0;kind<3;kind=kind+1) begin
                integer bytes;
                bytes=1<<kind;
                for(integer i=0;i<4;i=i+1) begin
                    memory.words[32768+i]=32'h73727170 + i*32'h04040404;
                    for(integer b=0;b<4;b=b+1) expected[4*i+b]=8'h70+4*i+b;
                end
                transfer(1,32'h08020000+offset,bytes,32'h12345678,got,fault);
                if(fault || got) $fatal(1,"write failed offset=%0d size=%0d",offset,bytes);
                for(integer b=0;b<bytes;b=b+1) expected[offset+b]=(32'h12345678 >> (8*b));
                for(integer i=0;i<16;i=i+1)
                    if(memory.words[32768+i/4][(i%4)*8 +:8]!==expected[i])
                        $fatal(1,"write byte mismatch offset=%0d size=%0d byte=%0d",offset,bytes,i);
                want=0;
                for(integer b=0;b<bytes;b=b+1) want=want | (expected[offset+b] << (8*b));
                transfer(0,32'h08020000+offset,bytes,0,got,fault);
                if(fault || got!==want) $fatal(1,"read offset=%0d size=%0d got=%h expected=%h",offset,bytes,got,want);
            end
        end
        memory.words[1048575]=32'haabbccdd;
        transfer(1,32'h083fffff,1,32'h12,got,fault);
        if(fault || memory.words[1048575]!==32'h12bbccdd) $fatal(1,"last byte write");
        transfer(0,32'h083ffffe,2,0,got,fault);
        if(fault || got!==32'h000012bb) $fatal(1,"last complete halfword");
        initial_writes=memory.writes;initial_reads=memory.reads;
        transfer(1,32'h083fffff,2,32'h1234,got,fault);
        if(fault!==1 || got!==0 || memory.words[1048575]!==32'h12bbccdd || memory.writes!=initial_writes)
            $fatal(1,"cross-end write issued or failed to fault");
        transfer(0,32'h083ffffe,4,0,got,fault);
        if(fault!==1 || got!==0 || memory.reads!=initial_reads) $fatal(1,"cross-end read issued or failed to fault");
        // Reset between native cycles abandons the second cycle and the old
        // response, without rolling back the already completed first write.
        memory.words[32768]=32'haaaaaaaa;memory.words[32769]=32'hbbbbbbbb;
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=1;req_address=32'h08020001;req_size_bytes=4;req_wdata=32'h13121110;
        tick();@(negedge clk);req_valid=0;
        wait(dut.state==3);#1;reset_n=0;#1;
        if(rsp_valid || req_ready) $fatal(1,"reset exposed old handshake");
        repeat(15) tick();
        if(memory.words[32768]!==32'h121110aa || memory.words[32769]!==32'hbbbbbbbb)
            $fatal(1,"reset changed already committed word or started second");
        reset_n=1;
        transfer(1,32'h08020001,4,32'h13121110,got,fault);
        transfer(0,32'h08020001,4,0,got,fault);
        if(fault || got!==32'h13121110 || memory.words[32769]!==32'hbbbbbb13)
            $fatal(1,"post-reset replay failed");
        $display("PASS CORE scalar RAM: %0d requests, all byte lanes/widths, DRAM bounds, reset and replay",operations);
        $finish;
    end
    initial begin #5000000;$fatal(1,"scalar RAM watchdog");end
endmodule
