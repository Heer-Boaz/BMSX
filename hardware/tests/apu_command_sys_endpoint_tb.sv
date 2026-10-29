`timescale 1ns/1ps
// Real SYS master and pin-level target: DATA acceptance, fault response,
// timeline stalls and diagnostic timeout semantics at the command owner.
module apu_command_sys_endpoint_tb;
    reg clk=0; always #5 clk=~clk;
    reg reset_n=0,req_valid=0,req_write=0,timeout_en=0,timeline_ready=1,consume=0;
    reg [31:0] req_addr=0,req_wdata=0;
    reg [3:0] req_be=0,req_header=15;
    wire req_ready,rsp_valid,rsp_timeout;
    wire [31:0] rsp_rdata,rsp_fault;
    wire [31:0] master_out,endpoint_out;
    wire master_oe,endpoint_oe,as_n,rd_n,wr_n,ready_low;
    wire [3:0] be_n;
    tri [31:0] ad;
    tri1 ready_n;
    assign ad=master_oe ? master_out : 32'bz;
    assign ad=endpoint_oe ? endpoint_out : 32'bz;
    assign ready_n=ready_low ? 1'b0 : 1'bz;
    wire fault_raise,command_valid;
    wire [31:0] fault_detail,command_word;
    wire [671:0] command_parameters;
    wire [4:0] queued_count;
    wire [3:0] selected_slot;
    reg [31:0] got_data,got_fault,last_fault=0;
    reg got_timeout;
    integer faults=0;
    system_bus_master master(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
        .req_write(req_write),.req_addr(req_addr),.req_wdata(req_wdata),.req_be_n(req_be),
        .req_header_be_n(req_header),.req_meta(32'b0),.bus_busy(),
        .req_data_timeout_enable(timeout_en),.req_data_wait_last(18'b0),
        .rsp_valid(rsp_valid),.rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault),.rsp_timeout(rsp_timeout),
        .bus_ad_in(ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),.bus_as_n(as_n),
        .bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ready_n(ready_n));
    wire local_valid,local_write,local_ready,local_response_valid;
    wire [4:0] local_index;wire [31:0] local_wdata,local_response_data;
    apu_command_sys_endpoint dut(.clk(clk),.reset_n(reset_n),.cs_apu_n(1'b0),.bus_ad_in(ad),
        .bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),
        .bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),.bus_ready_drive_low(ready_low),
        .local_valid(local_valid),.local_write(local_write),.local_index(local_index),.local_wdata(local_wdata),
        .local_ready(local_ready),.local_response_valid(local_response_valid),.local_response_data(local_response_data));
    apu_command_ingress ingress(.clk(clk),.reset_n(reset_n),.access_valid(local_valid),.access_write(local_write),
        .access_index(local_index),.access_wdata(local_wdata),.timeline_ready(timeline_ready),.access_ready(local_ready),
        .response_valid(local_response_valid),.response_data(local_response_data),.fault_raise(fault_raise),
        .fault_detail(fault_detail),.selected_slot(selected_slot),.queued_count(queued_count),
        .command_valid(command_valid),.command_consume(consume),.command_word(command_word),.command_parameters(command_parameters));
    always @(posedge clk) if(fault_raise) begin faults=faults+1; last_fault=fault_detail; end
    task transfer(input bit wr,input [31:0] address,input [31:0] value,input [3:0] be,
                  input [3:0] header,input bit timed);
        begin
            @(negedge clk); while(!req_ready) @(negedge clk);
            req_valid=1;req_write=wr;req_addr=address;req_wdata=value;req_be=be;req_header=header;timeout_en=timed;
            @(negedge clk);req_valid=0;
            while(!rsp_valid) @(negedge clk);
            got_data=rsp_rdata;got_fault=rsp_fault;got_timeout=rsp_timeout;
        end
    endtask
    task write_word(input [31:0] address,input [31:0] value);
        begin
            transfer(1,address,value,0,15,0);
            if(got_timeout || got_fault!=0) $fatal(1,"write fault addr=%h fault=%h",address,got_fault);
        end
    endtask
    task read_word(input [31:0] address,input [31:0] expected);
        begin
            transfer(0,address,0,0,15,0);
            if(got_timeout || got_fault!=0 || got_data!==expected)
                $fatal(1,"read %h = %h expected %h fault %h timeout %b",address,got_data,expected,got_fault,got_timeout);
        end
    endtask
    initial begin
        #12 reset_n=1;
        read_word(32'h0800012c,0);
        read_word(32'h0800014c,32'h10000);
        read_word(32'h08000150,32'h1000);
        read_word(32'h0800015c,32'h4000);
        read_word(32'h08000170,32'h800);
        write_word(32'h08000120,32'h12345678);
        write_word(32'h08000148,11);
        write_word(32'h08000174,0);
        read_word(32'h08000120,32'h12345678);
        if(selected_slot!==11 || queued_count!=0) $fatal(1,"zero command changed stage");
        write_word(32'h08000174,1);
        if(queued_count!=1 || !command_valid || command_word!=1 || command_parameters[31:0]!==32'h12345678 || command_parameters[10*32+:32]!==11)
            $fatal(1,"command snapshot mismatch");
        read_word(32'h08000120,0);
        @(negedge clk);consume=1;@(negedge clk);consume=0;
        if(queued_count!=0) $fatal(1,"consume failed");
        write_word(32'h08000120,32'habcdef01);
        timeline_ready=0;
        fork
            write_word(32'h08000174,2);
            begin
                wait(dut.local_valid); repeat(5) @(negedge clk);
                if(ready_low || queued_count!=0) $fatal(1,"timeline wait was bypassed");
                timeline_ready=1;
            end
        join
        if(queued_count!=1 || command_word!=2 || command_parameters[31:0]!=32'habcdef01)
            $fatal(1,"timeline release or duplicate command");
        @(negedge clk);consume=1;@(negedge clk);consume=0;
        write_word(32'h08000120,32'h11112222);
        write_word(32'h08000174,32'h80000001);
        if(faults!=1 || last_fault!==32'h80000001 || queued_count!=0) $fatal(1,"bad command event");
        read_word(32'h08000120,0);
        transfer(1,32'h08000120,32'h55555555,0,4'he,0);
        if(got_timeout || got_fault!=1) $fatal(1,"header fault missing");
        transfer(1,32'h08000120,32'h55555555,4'he,15,0);
        if(got_timeout || got_fault!=2) $fatal(1,"byte fault missing");
        transfer(1,32'h08000121,32'h55555555,0,15,0);
        if(got_timeout || got_fault!=2) $fatal(1,"alignment fault missing");
        read_word(32'h08000120,0);
        timeline_ready=0;
        transfer(1,32'h08000174,1,0,15,1);
        if(!got_timeout || queued_count!=0) $fatal(1,"stalled CMD timeout");
        timeline_ready=1; repeat(4) @(negedge clk);
        if(queued_count!=0) $fatal(1,"late enqueue after timeout");
        transfer(1,32'h08000120,32'h98765432,0,15,1);
        if(!got_timeout) $fatal(1,"expected timeout after owner acceptance");
        read_word(32'h08000120,32'h98765432);
        transfer(0,32'h08000178,0,0,15,1);
        if(!got_timeout) $fatal(1,"endpoint acknowledged another register owner");
        read_word(32'h08000120,32'h98765432);
        $display("PASS apu_command_sys_endpoint_tb");$finish;
    end
    initial begin #200000; $fatal(1,"test timed out"); end
endmodule
