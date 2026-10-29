`timescale 1ns/1ps
// Stateful golden requests from the unchanged TS decoder, cross-checked there
// against the actual output mixer. Every observed source read and masked write
// traverses the production sample-word store and fitted ISSI pin model. Source
// image initialization is model setup only, never a behavioral read port.
//
// Fixed events: op epoch voice arg0 arg1 arg2 expected-current expected-neighbor
// followed by the sixteen raw decoder fields emitted by apu_badp_vectors.ts.
// RESET=0, READ=1, PAIR=2 (current then distinct neighbor), WRITE=3. Writes commit
// between requests in this functional test. COINCIDENT=1 delays one overlapping
// invalidation until the next request's admission, exercising context-copy
// ordering; the physical write has already completed. No edge-atomic upload or
// complete mixer/arithmetic qualification is inferred. All output epochs,
// including zero and live resets, are timed; cold PLAY preparation is separate.
module apu_badp_decoder_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    localparam integer RAM_WORDS=131072, FRAME_CLOCKS=768;
    reg clk=0;
    always #(PERIOD/2.0) clk=~clk;
    reg reset_n=0, store_reset_n=0, power_reset_n=0;
    reg bind_valid=0;
    reg [3:0] bind_voice=0;
    reg [18:0] bind_source_base=0, bind_data_offset=0, bind_seek_base=0;
    reg [19:0] bind_source_bytes=0;
    reg [31:0] bind_frames=0, bind_seek_count=0;
    reg [31:0] bind_loop_start=0, bind_loop_end=0;
    reg [1:0] bind_channels=0;
    reg req_valid=0, req_reset=0;
    wire req_ready, rsp_valid;
    reg [3:0] req_voice=0;
    reg [31:0] req_frame=0;
    wire [31:0] rsp_samples;
    reg source_write_valid=0;
    reg [16:0] source_write_word=0;
    reg [4:0] source_write_words=0;
    reg epoch_begin=0, epoch_active=0;
    wire epoch_change_valid=0; wire [16:0] epoch_change_first=0, epoch_change_last=0;
    wire memory_req_valid, memory_req_ready, memory_rsp_valid;
    wire [16:0] memory_req_word_address;
    wire [31:0] memory_rsp_word;
    apu_badp_decoder dut (.*);

    reg host_mode=0, host_valid=0;
    reg [16:0] host_word=0;
    reg [31:0] host_data=0;
    reg [3:0] host_be_n=4'hf;
    wire store_valid=host_mode ? host_valid : memory_req_valid;
    wire store_write=host_mode;
    wire [16:0] store_word=host_mode ? host_word : memory_req_word_address;
    wire [31:0] store_data=host_mode ? host_data : 32'd0;
    wire [3:0] store_be_n=host_mode ? host_be_n : 4'b0000;
    wire store_ready, store_rsp_valid, memory_ready;
    wire [31:0] store_rsp_data;
    assign memory_req_ready=!host_mode && store_ready;
    assign memory_rsp_valid=!host_mode && store_rsp_valid;
    assign memory_rsp_word=store_rsp_data;
    wire [17:0] mem_address;
    tri [15:0] mem_data;
    wire mem_ce_n, mem_oe_n, mem_we_n;
    wire [1:0] mem_be_n;
    wire chip_drives;
    apu_sample_store store (
        .clk(clk),.reset_n(store_reset_n),.power_reset_n(power_reset_n),
        .req_valid(store_valid),.req_ready(store_ready),.req_write(store_write),
        .req_word_address(store_word),.req_wdata(store_data),.req_be_n(store_be_n),
        .rsp_valid(store_rsp_valid),.rsp_rdata(store_rsp_data),.memory_ready(memory_ready),
        .mem_address(mem_address),.mem_data(mem_data),.mem_ce_n(mem_ce_n),
        .mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(18),.PATTERN(16'hbad8)) device (
        .address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),
        .we_n(mem_we_n),.be_n(mem_be_n),.drive_active(chip_drives)
    );

    reg [31:0] expected_words [0:RAM_WORDS-1];
    integer cycle=0, clear_start=0, clear_cycles=0, clear_writes=0;
    integer physical_reads=0, physical_writes=0, checkpoint_hits=0;
    reg checking=0, clearing=0, word_active=0, active_write=0;
    integer coincident_mode=0, pending_invalidations=0, coincident_admissions=0;
    reg [16:0] pending_write_word [0:255];
    reg [16:0] active_word;
    reg [31:0] active_value;
    always @(posedge clk) begin
        cycle=cycle+1;
        if(checking) begin
            if(store_valid && store_ready) begin
                if(word_active) $fatal(1,"BADP memory response owner overwritten");
                word_active=1;active_write=store_write;active_word=store_word;
                active_value=expected_words[store_word];
                if(store_write) for(integer lane=0;lane<4;lane=lane+1)
                    if(!store_be_n[lane]) active_value[lane*8+:8]=store_data[lane*8+:8];
            end
            if(dut.state==dut.LOOKUP && !dut.reset_request &&
               dut.ctx.decoded_frame!=dut.target && dut.ctx.previous_frame!=dut.target && dut.cache_hit)
                checkpoint_hits=checkpoint_hits+1;
            #0.001;
            if(store_rsp_valid) begin
                if(!word_active) $fatal(1,"BADP SRAM reply without request");
                if(active_write) begin
                    if(store_rsp_data!==32'd0) $fatal(1,"BADP SRAM write reply is not zero");
                    expected_words[active_word]=active_value;
                    if({device.words[active_word*2+1],device.words[active_word*2]}!==active_value)
                        $fatal(1,"BADP masked write did not reach real SRAM pins");
                    physical_writes=physical_writes+1;
                end else begin
                    if(store_rsp_data!==active_value)
                        $fatal(1,"BADP SRAM word %0d returned %h expected %h",active_word,store_rsp_data,active_value);
                    physical_reads=physical_reads+1;
                end
                word_active=0;
            end
        end
    end
    always @(mem_data or chip_drives or store.pins.data_drive) if(checking)
        if(chip_drives && store.pins.data_drive) $fatal(1,"BADP SRAM drivers overlap");
    always @(posedge mem_we_n) if(clearing && store_reset_n && power_reset_n && !mem_ce_n)
        clear_writes=clear_writes+1;

    typedef struct packed {
        logic signed [15:0] pred_l,pred_r;
        logic [7:0] index_l,index_r;
        logic [31:0] next_frame,block_end,block_frames,block_index,payload_offset,nibble_cursor;
        logic [31:0] decoded_frame,decoded_sample,previous_frame,previous_sample;
        logic predictor_clean,decoded_clean,previous_clean;
    } observed_context_t;
    observed_context_t observed;
    integer expected_state [0:15];
    integer state_checks=0, operand_checks=0;
    string scenario_name;
    integer slot_base=0;
    integer event_index=0, event_epoch=0, event_voice=0;
    task automatic check_context(input integer selected_voice);
        reg [31:0] actual [0:15];
        begin
            observed=dut.context_valid[selected_voice+slot_base] ?
                {dut.context_data[selected_voice+slot_base],dut.context_clean[selected_voice+slot_base]} : dut.EMPTY_CONTEXT;
            actual[0]={{16{observed.pred_l[15]}},observed.pred_l};
            actual[1]={{16{observed.pred_r[15]}},observed.pred_r};
            actual[2]={24'd0,observed.index_l};actual[3]={24'd0,observed.index_r};
            actual[4]=observed.next_frame;actual[5]=observed.block_end;
            actual[6]=observed.block_frames;actual[7]=observed.block_index;
            actual[8]=observed.payload_offset;actual[9]=observed.nibble_cursor;
            actual[10]=observed.decoded_frame;actual[11]=observed.decoded_sample;
            actual[12]=observed.previous_frame;actual[13]=observed.previous_sample;
            actual[14]=observed.decoded_frame==32'hffffffff ? 0 : 1;
            actual[15]=observed.previous_frame==32'hffffffff ? 0 : 1;
            for(integer field=0;field<16;field=field+1)
                if(actual[field]!==expected_state[field])
                    $fatal(1,"BADP %0s event%0d epoch%0d voice%0d field%0d actual=%h expected=%h",scenario_name,event_index,event_epoch,selected_voice,field,actual[field],expected_state[field]);
            state_checks=state_checks+1;
        end
    endtask

    task automatic request_frame(input integer selected_voice,input reg is_reset,
                                 input reg [31:0] frame,input reg compare_sample,
                                 input reg [31:0] expected_sample,output integer elapsed);
        integer started;
        begin
            started=cycle;
            while(!req_ready) @(negedge clk);
            // Preserve all affected extents while reserving the first queued
            // write for the exact incoming-context copy edge. The first changed
            // bank is voice0 in the overlap fixtures, as is the next request.
            for(integer pending=pending_invalidations-1;pending>0;pending=pending-1) begin
                source_write_word=pending_write_word[pending];source_write_words=1;source_write_valid=1;
                @(negedge clk);
            end
            if(pending_invalidations!=0) begin
                source_write_word=pending_write_word[0];source_write_words=1;source_write_valid=1;
                coincident_admissions=coincident_admissions+1;
            end
            req_voice=selected_voice+slot_base;req_reset=is_reset;req_frame=frame;req_valid=1;
            @(negedge clk);req_valid=0;source_write_valid=0;pending_invalidations=0;
            while(!rsp_valid) @(negedge clk);
            if(compare_sample) begin
                if(rsp_samples!==expected_sample)
                    $fatal(1,"BADP %0s event%0d epoch%0d voice%0d frame%0d sample=%h expected=%h",scenario_name,event_index,event_epoch,selected_voice,frame,rsp_samples,expected_sample);
                operand_checks=operand_checks+1;
            end
            elapsed=cycle-started;
        end
    endtask

    task automatic commit_word(input reg [18:0] byte_address,input reg [3:0] byte_mask,
                               input reg [31:0] data_word);
        begin
            if(word_active || memory_req_valid) $fatal(1,"Fixture WRITE overlapped a decoder request");
            host_mode=1;host_word=byte_address[18:2];host_data=data_word;host_be_n=~byte_mask;
            while(!store_ready) @(negedge clk);
            host_valid=1;@(negedge clk);host_valid=0;
            while(!store_rsp_valid) @(negedge clk);
            host_mode=0;
            if(coincident_mode!=0) begin
                pending_write_word[pending_invalidations]=byte_address[18:2];
                pending_invalidations=pending_invalidations+1;
            end else begin
                source_write_word=byte_address[18:2];source_write_words=1;source_write_valid=1;
                @(negedge clk);source_write_valid=0;
            end
        end
    endtask

    string trace_path="build/tests/apu-badp-request-input.txt";
    string report_path="build/reports/badp-decoder.json";
    integer trace_file,report_file,scan,scenario_count,source_words,voice_count,event_count;
    integer descriptor_voice [0:7],descriptor_base [0:7],descriptor_offset [0:7];
    integer descriptor_frames [0:7],descriptor_channels [0:7],descriptor_seek [0:7],descriptor_count [0:7];
    integer descriptor_loop_start [0:7],descriptor_loop_end [0:7];
    integer op,arg0,arg1,arg2,current_sample,neighbor_sample;
    integer elapsed,neighbor_elapsed,active_epoch,epoch_start,epoch_elapsed;
    integer cold_cycles,cold_requests,cold_max_request,cold_start;
    integer epoch_count,epoch_max,epoch_max_tag,first_epoch_cycles,missed_epochs,lateness;
    integer read_before,write_before,hits_before,checks_before,operands_before;
    integer epoch_read_before,epoch_write_before,epoch_hits_before;
    integer reset_rows,reset_epoch [0:63],reset_voice [0:63],reset_frame [0:63],reset_clocks [0:63];
    integer reset_block_frames [0:63],reset_block_index [0:63],reset_nibbles [0:63],reset_payload [0:63];
    integer total_epochs=0,total_misses=0,total_cold_requests=0,total_events=0;
    reg [31:0] image_word;
    reg first_epoch;

    task automatic finish_epoch;
        begin
            epoch_elapsed=cycle-epoch_start;
            if(!first_epoch) $fwrite(report_file,",");
            $fwrite(report_file,"{\"epoch\":%0d,\"decoder_and_serialized_writes_clocks\":%0d,\"physical_reads\":%0d,\"physical_writes\":%0d,\"checkpoint_hits\":%0d,\"deadline_missed\":%0d}",active_epoch,epoch_elapsed,physical_reads-epoch_read_before,physical_writes-epoch_write_before,checkpoint_hits-epoch_hits_before,epoch_elapsed>FRAME_CLOCKS);
            first_epoch=0;epoch_count=epoch_count+1;total_epochs=total_epochs+1;
            if(epoch_count==1) first_epoch_cycles=epoch_elapsed;
            if(epoch_elapsed>epoch_max) begin epoch_max=epoch_elapsed;epoch_max_tag=active_epoch;end
            if(epoch_elapsed>FRAME_CLOCKS) begin
                missed_epochs=missed_epochs+1;total_misses=total_misses+1;
                lateness=lateness+epoch_elapsed-FRAME_CLOCKS;
            end
        end
    endtask

    initial begin
        if($value$plusargs("TRACE=%s",trace_path)) begin end
        if($value$plusargs("REPORT=%s",report_path)) begin end
        if($value$plusargs("COINCIDENT=%d",coincident_mode)) begin end
        if($value$plusargs("SLOT_BASE=%d",slot_base)) begin end
        trace_file=$fopen(trace_path,"r");report_file=$fopen(report_path,"w");
        if(trace_file==0 || report_file==0) $fatal(1,"Cannot open BADP vectors/report");
        scan=$fscanf(trace_file,"%d",scenario_count);
        if(scan!=1 || scenario_count<=0) $fatal(1,"BADP vectors lack a scenario catalogue");
        for(integer n=0;n<RAM_WORDS;n=n+1) expected_words[n]=0;
        #2;repeat(20) @(negedge clk);clear_start=cycle;clearing=1;
        power_reset_n=1;store_reset_n=1;
        wait(memory_ready);@(negedge clk);clearing=0;clear_cycles=cycle-clear_start;
        if(clear_writes!=262144) $fatal(1,"BADP sample SRAM was not physically reset once");
        checking=1;
        $fwrite(report_file,"{\"scope\":\"Actual stateful BADP RTL and pinned canonical loop checkpoints against unchanged decoder/mixer golden requests through production sample-store and ISSI pins. Writes are serialized functional commits; optional invalidation coincides with next request admission. Neither mode proves edge-atomic concurrent uploads or full mixer execution. Ready39-word cases are capacity probes, not legal global arrival guarantees. No cold-start grace period or first-epoch exclusion is granted.\",\"clock_hz\":33868800,\"frame_clocks\":768,\"coincident_invalidation_mode\":%0d,\"physical_slot_base\":%0d,\"physical_reset_clear_clocks\":%0d,\"scenarios\":[",coincident_mode,slot_base,clear_cycles);
        for(integer scenario=0;scenario<scenario_count;scenario=scenario+1) begin
            reset_n=0;repeat(2) @(negedge clk);reset_n=1;
            scan=$fscanf(trace_file,"%s %d %d %d",scenario_name,source_words,voice_count,event_count);
            if(scan!=4 || source_words>RAM_WORDS || voice_count!=8) $fatal(1,"Incomplete BADP scenario header");
            for(integer word=0;word<source_words;word=word+1) begin
                scan=$fscanf(trace_file,"%h",image_word);
                if(scan!=1) $fatal(1,"Incomplete BADP source image");
                expected_words[word]=image_word;
                device.words[word*2]=image_word[15:0];device.words[word*2+1]=image_word[31:16];
            end
            for(integer voice_index=0;voice_index<voice_count;voice_index=voice_index+1) begin
                scan=$fscanf(trace_file,"%d %d %d %d %d %d %d %d %d",descriptor_voice[voice_index],descriptor_base[voice_index],descriptor_offset[voice_index],descriptor_frames[voice_index],descriptor_channels[voice_index],descriptor_seek[voice_index],descriptor_count[voice_index],descriptor_loop_start[voice_index],descriptor_loop_end[voice_index]);
                if(scan!=9 || descriptor_voice[voice_index]!=voice_index) $fatal(1,"Incomplete BADP voice descriptor");
            end
            for(integer voice_index=0;voice_index<voice_count;voice_index=voice_index+1) begin
                bind_valid=1;bind_voice=voice_index+slot_base;bind_source_base=descriptor_base[voice_index];
                // The last256 bytes are the fixture's disjoint upload buffer.
                bind_source_bytes=voice_index==7 ? source_words*4-256-descriptor_base[voice_index] : descriptor_base[voice_index+1]-descriptor_base[voice_index];
                bind_data_offset=descriptor_offset[voice_index];bind_frames=descriptor_frames[voice_index];
                bind_channels=descriptor_channels[voice_index];bind_seek_base=descriptor_seek[voice_index];
                bind_seek_count=descriptor_count[voice_index];bind_loop_start=descriptor_loop_start[voice_index];
                bind_loop_end=descriptor_loop_end[voice_index];@(negedge clk);
                observed=dut.context_valid[bind_voice] ?
                    {dut.context_data[bind_voice],dut.context_clean[bind_voice]} : dut.EMPTY_CONTEXT;
                if(observed.decoded_frame!==32'hffffffff || observed.previous_frame!==32'hffffffff)
                    $fatal(1,"Bound decoder produced a false retained frame zero");
                if(!dut.source_bound[bind_voice]) $fatal(1,"Bound source has no address-decode owner");
            end
            bind_valid=0;
            read_before=physical_reads;write_before=physical_writes;hits_before=checkpoint_hits;
            checks_before=state_checks;operands_before=operand_checks;
            cold_cycles=0;cold_requests=0;cold_max_request=0;cold_start=cycle;reset_rows=0;pending_invalidations=0;
            active_epoch=-1;epoch_count=0;epoch_max=0;epoch_max_tag=0;missed_epochs=0;lateness=0;
            first_epoch_cycles=0;first_epoch=1;
            if(scenario!=0) $fwrite(report_file,",");
            $fwrite(report_file,"{\"id\":\"%0s\",\"source_image_bytes\":%0d,\"voices\":8,\"events\":%0d,\"output_epochs\":[",scenario_name,source_words*4,event_count);
            for(event_index=0;event_index<event_count;event_index=event_index+1) begin
                scan=$fscanf(trace_file,"%d %d %d %d %d %d %d %d",op,event_epoch,event_voice,arg0,arg1,arg2,current_sample,neighbor_sample);
                if(scan!=8) $fatal(1,"Incomplete BADP request event");
                for(integer field=0;field<16;field=field+1) begin
                    scan=$fscanf(trace_file,"%d",expected_state[field]);
                    if(scan!=1) $fatal(1,"Incomplete BADP raw state");
                end
                if(event_epoch!=active_epoch) begin
                    if(active_epoch>=0) finish_epoch();
                    else cold_cycles=cycle-cold_start;
                    active_epoch=event_epoch;epoch_start=cycle;
                    epoch_read_before=physical_reads;epoch_write_before=physical_writes;
                    epoch_hits_before=checkpoint_hits;
                    epoch_begin=1;@(negedge clk);epoch_begin=0;
                end
                case(op)
                    0: begin
                        request_frame(event_voice,1,arg0,0,0,elapsed);
                        reset_epoch[reset_rows]=event_epoch;reset_voice[reset_rows]=event_voice;
                        reset_frame[reset_rows]=arg0;reset_clocks[reset_rows]=elapsed;
                        reset_block_frames[reset_rows]=dut.ctx.block_frames;
                        reset_block_index[reset_rows]=dut.ctx.block_index;
                        reset_nibbles[reset_rows]=dut.ctx.nibble_cursor;
                        reset_payload[reset_rows]=descriptor_base[event_voice]+descriptor_offset[event_voice]+dut.ctx.payload_offset;
                        reset_rows=reset_rows+1;
                        if(event_epoch<0) begin
                            cold_requests=cold_requests+1;total_cold_requests=total_cold_requests+1;
                            if(elapsed>cold_max_request) cold_max_request=elapsed;
                        end
                    end
                    1: request_frame(event_voice,0,arg0,1,current_sample,elapsed);
                    2: begin
                        request_frame(event_voice,0,arg0,1,current_sample,elapsed);
                        if(arg1!=arg0) request_frame(event_voice,0,arg1,1,neighbor_sample,neighbor_elapsed);
                        else if(neighbor_sample!==current_sample) $fatal(1,"Same-frame PAIR has different operands");
                    end
                    3: commit_word(arg0,arg1,arg2);
                    default: $fatal(1,"Unknown BADP event opcode");
                endcase
                check_context(event_voice);
                total_events=total_events+1;
            end
            if(active_epoch>=0) finish_epoch();
            $fwrite(report_file,"],\"reset_requests\":[");
            for(integer row=0;row<reset_rows;row=row+1) begin
                if(row!=0) $fwrite(report_file,",");
                $fwrite(report_file,"{\"epoch\":%0d,\"voice\":%0d,\"frame\":%0d,\"clocks\":%0d,\"block_frames\":%0d,\"block_frames_decoded\":%0d,\"payload_nibbles_decoded\":%0d,\"payload_byte_address\":%0d}",reset_epoch[row],reset_voice[row],reset_frame[row],reset_clocks[row],reset_block_frames[row],reset_block_index[row],reset_nibbles[row],reset_payload[row]);
            end
            $fwrite(report_file,"],\"cold_reset_requests\":%0d,\"cold_reset_clocks\":%0d,\"cold_max_single_voice_clocks\":%0d,\"cold_reset_exceeds_one_frame\":%0d,\"first_output_clocks\":%0d,\"cold_plus_first_output_clocks\":%0d,\"output_epoch_count\":%0d,\"maximum_output_clocks\":%0d,\"maximum_output_epoch\":%0d,\"output_deadline_misses\":%0d,\"total_output_lateness_clocks\":%0d,\"checkpoint_hits\":%0d,\"physical_source_reads\":%0d,\"physical_writes\":%0d,\"raw_state_checks\":%0d,\"operand_checks\":%0d}",cold_requests,cold_cycles,cold_max_request,cold_cycles>FRAME_CLOCKS,first_epoch_cycles,cold_cycles+first_epoch_cycles,epoch_count,epoch_max,epoch_max_tag,missed_epochs,lateness,checkpoint_hits-hits_before,physical_reads-read_before,physical_writes-write_before,state_checks-checks_before,operand_checks-operands_before);
            $display("BADP_DECODER %0s cold=%0d first=%0d peak=%0d/768 misses=%0d hits=%0d reads=%0d writes=%0d",scenario_name,cold_cycles,first_epoch_cycles,epoch_max,missed_epochs,checkpoint_hits-hits_before,physical_reads-read_before,physical_writes-write_before);
        end
        $fdisplay(report_file,"],\"total_events\":%0d,\"total_cold_requests\":%0d,\"total_output_epochs\":%0d,\"total_output_deadline_misses\":%0d,\"total_checkpoint_hits\":%0d,\"total_physical_reads\":%0d,\"total_physical_writes\":%0d,\"total_state_checks\":%0d,\"total_operand_checks\":%0d,\"coincident_write_invalidation_admissions\":%0d}",total_events,total_cold_requests,total_epochs,total_misses,checkpoint_hits,physical_reads,physical_writes,state_checks,operand_checks,coincident_admissions);
        $fclose(trace_file);$fclose(report_file);
        $display("PASS apu_badp_decoder: %0d exact stateful scenarios, %0d events, %0d output epochs; timing misses reported",scenario_count,total_events,total_epochs);
        $finish;
    end
    initial begin #1000000000;$fatal(1,"Stateful BADP decoder watchdog");end
endmodule
