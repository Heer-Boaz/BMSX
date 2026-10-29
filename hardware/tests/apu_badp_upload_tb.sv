`timescale 1ns/1ps
// Actual eight-stereo BADP operand/state requests share real sample SRAM with
// globally timed DMA_WRITE batches. Golden bytes and states come unchanged from
// apu_badp_vectors.ts; no BADP arithmetic, decoder or memory peer lives here.
// Static cases receive disjoint uploads. Existing mutation cases receive real
// full-word batches with a final publication on their logical mutation edge.
// The two-frame case groups its last source bank's changes in one contiguous
// batch, so that a previously valid checkpoint is touched for the first time
// on the same edge that opens the new output epoch.
// This is the decoder + snapshot memory slice, not a complete APU mixer.
module apu_badp_upload_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    localparam integer RAM_WORDS=131072, FRAME_CLOCKS=768, MAX_EVENTS=4096, MAX_UPLOADS=512;
    reg clk=0;
    always #(PERIOD/2.0) clk=~clk;
    reg reset_n=0, store_reset_n=0, power_reset_n=0;
    reg bind_valid=0;
    reg [3:0] bind_voice=0;
    reg [18:0] bind_source_base=0,bind_data_offset=0,bind_seek_base=0;
    reg [19:0] bind_source_bytes=0;
    reg [31:0] bind_frames=0,bind_seek_count=0,bind_loop_start=0,bind_loop_end=0;
    reg [1:0] bind_channels=0;
    reg req_valid=0,req_reset=0;
    reg [3:0] req_voice=0;
    reg [31:0] req_frame=0;
    wire req_ready,rsp_valid;
    wire [31:0] rsp_samples;
    reg epoch_begin=0,epoch_end=0;
    wire epoch_active;
    wire memory_req_valid,memory_req_ready,memory_rsp_valid;
    wire [16:0] memory_req_word_address;
    wire [31:0] memory_rsp_word;
    wire publish_valid;
    wire [16:0] publish_base;
    wire [4:0] publish_words;
    apu_badp_decoder decoder (
        .clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(bind_voice),
        .bind_source_base(bind_source_base),.bind_source_bytes(bind_source_bytes),
        .bind_data_offset(bind_data_offset),.bind_frames(bind_frames),.bind_channels(bind_channels),
        .bind_seek_base(bind_seek_base),.bind_seek_count(bind_seek_count),
        .bind_loop_start(bind_loop_start),.bind_loop_end(bind_loop_end),
        .req_valid(req_valid),.req_ready(req_ready),.req_reset(req_reset),
        .req_voice(req_voice),.req_frame(req_frame),.rsp_valid(rsp_valid),.rsp_samples(rsp_samples),
        .source_write_valid(publish_valid),.source_write_word(publish_base),.source_write_words(publish_words),
        .epoch_begin(epoch_begin),.epoch_active(epoch_active),.epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),
        .memory_req_valid(memory_req_valid),.memory_req_ready(memory_req_ready),
        .memory_req_word_address(memory_req_word_address),.memory_rsp_valid(memory_rsp_valid),
        .memory_rsp_word(memory_rsp_word)
    );
    reg stage_valid=0,start_valid=0;
    reg [3:0] stage_index=0;
    reg [31:0] stage_word=0;
    reg [4:0] start_words=0;
    reg [16:0] live_word_address=0;
    wire start_ready,batch_busy,commit_valid;
    wire [4:0] commit_words;
    wire [16:0] commit_base,commit_next_address;
    wire [6:0] queued_words,epoch_words;
    wire memory_ready,store_req_valid,store_req_ready,store_req_write,store_rsp_valid;
    wire [16:0] store_req_word_address;
    wire [31:0] store_req_wdata,store_rsp_rdata;
    wire [3:0] store_req_be_n;
    apu_upload_commit uploads (
        .clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),
        .stage_valid(stage_valid),.stage_index(stage_index),.stage_word(stage_word),
        .start_valid(start_valid),.start_ready(start_ready),.start_words(start_words),
        .cancel(1'b0),.live_word_address(live_word_address),.batch_busy(batch_busy),
        .publish_valid(publish_valid),.publish_base(publish_base),.publish_words(publish_words),
        .commit_valid(commit_valid),.commit_words(commit_words),.commit_base(commit_base),
        .commit_next_address(commit_next_address),.epoch_begin(epoch_begin),.epoch_end(epoch_end),
        .epoch_active(epoch_active),.queued_words(queued_words),.epoch_words(epoch_words),
        .read_valid(memory_req_valid),.read_ready(memory_req_ready),
        .read_word_address(memory_req_word_address),.read_rsp_valid(memory_rsp_valid),.read_rsp_word(memory_rsp_word),
        .memory_ready(memory_ready),.store_req_valid(store_req_valid),.store_req_ready(store_req_ready),
        .store_req_write(store_req_write),.store_req_word_address(store_req_word_address),
        .store_req_wdata(store_req_wdata),.store_req_be_n(store_req_be_n),
        .store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_rdata)
    );
    wire [17:0] mem_address;
    tri [15:0] mem_data;
    wire mem_ce_n,mem_oe_n,mem_we_n,chip_drives;
    wire [1:0] mem_be_n;
    apu_sample_store store (
        .clk(clk),.reset_n(store_reset_n),.power_reset_n(power_reset_n),
        .req_valid(store_req_valid),.req_ready(store_req_ready),.req_write(store_req_write),
        .req_word_address(store_req_word_address),.req_wdata(store_req_wdata),.req_be_n(store_req_be_n),
        .rsp_valid(store_rsp_valid),.rsp_rdata(store_rsp_rdata),.memory_ready(memory_ready),
        .mem_address(mem_address),.mem_data(mem_data),.mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),
        .mem_we_n(mem_we_n),.mem_be_n(mem_be_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(18),.PATTERN(16'hbad8)) device (
        .address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),
        .we_n(mem_we_n),.be_n(mem_be_n),.drive_active(chip_drives)
    );

    integer cycle=0,physical_reads=0,physical_writes=0,checkpoint_hits=0;
    integer operands=0,state_checks=0,total_epochs=0,total_misses=0,total_cases=0;
    integer total_offers=0,total_rejected=0,total_publications=0,total_published_words=0;
    integer simultaneous_epoch_publications=0,total_forwarded_reads=0;
    integer overlapping_epoch_publications=0;
    integer live_checkpoint_epoch_publications=0;
    reg [15:0] opening_touched;
    reg checking=0,word_active=0,active_write=0;
    reg [16:0] active_word;
    reg [31:0] active_value;
    reg [31:0] expected_words[0:RAM_WORDS-1];
    integer upload_count=0,upload_start[0:MAX_UPLOADS-1],upload_size[0:MAX_UPLOADS-1];
    integer upload_base[0:MAX_UPLOADS-1],upload_seed[0:MAX_UPLOADS-1];
    reg [31:0] upload_data[0:MAX_UPLOADS-1][0:15];
    reg upload_accepted[0:MAX_UPLOADS-1];
    integer offered_index=-1,inflight_index=-1;
    reg driver_enabled=0;
    integer offers=0,rejected=0,publications=0,published_words=0,peak_queue=0;
    integer publication_cycle[0:MAX_UPLOADS-1],publication_batch[0:MAX_UPLOADS-1];
    integer near_epoch_commits=0;
    always @(posedge clk) begin
        cycle=cycle+1;
        if(checking) begin
            opening_touched=(publish_valid && epoch_begin) ? decoder.touched : 16'd0;
            if(publish_valid && decoder.touched[15:8]!=0)
                $fatal(1,"An unbound native slot participated in source-write interval decoding");
            for(integer v=0;v<16;v=v+1)
                if(opening_touched[v] && !decoder.dirty[v] && decoder.checkpoint_valid[v*2+:2]!=0)
                    live_checkpoint_epoch_publications=live_checkpoint_epoch_publications+1;
            if(store_req_valid && store_req_ready) begin
                if(word_active) $fatal(1,"Integrated SRAM request owner overwritten");
                word_active=1;active_write=store_req_write;active_word=store_req_word_address;
                active_value=store_req_write ? store_req_wdata : expected_words[store_req_word_address];
            end
            if(decoder.state==decoder.LOOKUP && !decoder.reset_request &&
               decoder.ctx.decoded_frame!=decoder.target && decoder.ctx.previous_frame!=decoder.target && decoder.cache_hit)
                checkpoint_hits=checkpoint_hits+1;
            if(memory_req_valid && memory_req_ready && uploads.hit) total_forwarded_reads=total_forwarded_reads+1;
            if(publish_valid) begin
                if(inflight_index<0 || cycle!=upload_start[inflight_index]+32*upload_size[inflight_index] ||
                   publish_base!==upload_base[inflight_index] || publish_words!==upload_size[inflight_index])
                    $fatal(1,"Integrated global-time publication differs from accepted start at %0d",cycle);
                publication_cycle[publications]=cycle;publication_batch[publications]=inflight_index;
                publications=publications+1;published_words=published_words+publish_words;
                total_publications=total_publications+1;total_published_words=total_published_words+publish_words;
                if(epoch_begin) begin near_epoch_commits=near_epoch_commits+1;simultaneous_epoch_publications=simultaneous_epoch_publications+1;end
                inflight_index=-1;
            end
            if(start_valid) begin
                offers=offers+1;total_offers=total_offers+1;
                upload_accepted[offered_index]=start_ready;
                if(start_ready) inflight_index=offered_index;
                else begin rejected=rejected+1;total_rejected=total_rejected+1;end
            end
            #0.001;
            if(opening_touched!=0) begin
                overlapping_epoch_publications=overlapping_epoch_publications+1;
                for(integer v=0;v<16;v=v+1)
                    if(opening_touched[v] && decoder.checkpoint_valid[v*2+:2]!==2'b00)
                        $fatal(1,"Same-edge published source retained a stale canonical checkpoint for slot %0d",v);
            end
            if(queued_words>64 || epoch_words>queued_words) $fatal(1,"Integrated epoch queue overflow");
            if(queued_words>peak_queue) peak_queue=queued_words;
            if(store_rsp_valid) begin
                if(!word_active) $fatal(1,"Integrated SRAM response without request");
                if(active_write) begin
                    expected_words[active_word]=active_value;
                    if({device.words[active_word*2+1],device.words[active_word*2]}!==active_value)
                        $fatal(1,"Integrated published write missed physical pins");
                    physical_writes=physical_writes+1;
                end else begin
                    if(store_rsp_rdata!==active_value) $fatal(1,"Integrated physical read wrong word %0d",active_word);
                    physical_reads=physical_reads+1;
                end
                word_active=0;
            end
        end
    end
    always @(negedge clk) if(driver_enabled) begin
        stage_valid=0;start_valid=0;offered_index=-1;
        if(inflight_index>=0) live_word_address=upload_base[inflight_index];
        for(integer b=0;b<upload_count;b=b+1) begin
            // Repeated disjoint batches use identical data. Thus preparation
            // overlapping an earlier pending batch never changes its words.
            if(cycle+1>=upload_start[b]-upload_size[b] && cycle+1<upload_start[b]) begin
                stage_valid=1;stage_index=cycle+1-(upload_start[b]-upload_size[b]);
                stage_word=upload_data[b][stage_index];
            end
            if(cycle+1==upload_start[b]) begin
                start_valid=1;start_words=upload_size[b];offered_index=b;
                if(inflight_index<0) live_word_address=upload_base[b];
            end
        end
    end
    always @(mem_data or chip_drives or store.pins.data_drive) if(checking)
        if(chip_drives && store.pins.data_drive) $fatal(1,"Integrated SRAM drivers overlap");

    typedef struct packed {
        logic signed [15:0] pred_l,pred_r;
        logic [7:0] index_l,index_r;
        logic [31:0] next_frame,block_end,block_frames,block_index,payload_offset,nibble_cursor;
        logic [31:0] decoded_frame,decoded_sample,previous_frame,previous_sample;
        logic predictor_clean,decoded_clean,previous_clean;
    } observed_context_t;
    observed_context_t observed;
    integer events[0:MAX_EVENTS-1][0:23];
    integer descriptors[0:7][0:8];
    string scenario_name;
    integer event_index=0;
    task automatic check_context(input integer voice,input integer row);
        reg [31:0] actual[0:15];
        begin
            observed=decoder.context_valid[voice] ?
                {decoder.context_data[voice],decoder.context_clean[voice]} : decoder.EMPTY_CONTEXT;
            actual[0]={{16{observed.pred_l[15]}},observed.pred_l};actual[1]={{16{observed.pred_r[15]}},observed.pred_r};
            actual[2]=observed.index_l;actual[3]=observed.index_r;
            actual[4]=observed.next_frame;actual[5]=observed.block_end;actual[6]=observed.block_frames;
            actual[7]=observed.block_index;actual[8]=observed.payload_offset;actual[9]=observed.nibble_cursor;
            actual[10]=observed.decoded_frame;actual[11]=observed.decoded_sample;
            actual[12]=observed.previous_frame;actual[13]=observed.previous_sample;
            actual[14]=observed.decoded_frame!=32'hffffffff;actual[15]=observed.previous_frame!=32'hffffffff;
            for(integer f=0;f<16;f=f+1)
                if(actual[f]!==events[row][8+f]) $fatal(1,"Integrated %s event %0d voice %0d context field %0d got %h expected %h",scenario_name,row,voice,f,actual[f],events[row][8+f]);
            state_checks=state_checks+1;
        end
    endtask
    task automatic request_frame(input integer voice,input bit reset_request,input [31:0] frame,
                                 input bit compare,input [31:0] expected);
        begin
            @(negedge clk);
            while(!req_ready) @(negedge clk);
            req_voice=voice;req_reset=reset_request;req_frame=frame;req_valid=1;
            @(negedge clk);req_valid=0;
            while(!rsp_valid) @(negedge clk);
            if(compare) begin
                if(rsp_samples!==expected) $fatal(1,"Integrated %s event %0d voice %0d frame %0d got %h expected %h",scenario_name,event_index,voice,frame,rsp_samples,expected);
                operands=operands+1;
            end
        end
    endtask
    task automatic add_upload(input integer at_cycle,input integer n,input integer base,input integer seed);
        begin
            if(upload_count==MAX_UPLOADS) $fatal(1,"Integrated upload schedule exceeds fixture storage");
            upload_start[upload_count]=at_cycle;upload_size[upload_count]=n;
            upload_base[upload_count]=base;upload_seed[upload_count]=seed;
            for(integer j=0;j<16;j=j+1) upload_data[upload_count][j]=seed+j;
            upload_accepted[upload_count]=0;upload_count=upload_count+1;
        end
    endtask

    string trace_path="build/tests/apu-badp-request-input.txt";
    string report_path="build/reports/apu-badp-upload.json";
    integer trace_file,report_file,scan,scan_word,scenario_count,source_words,voices,event_count;
    reg [31:0] image_word;
    reg selected,overlapping,variable_batches;
    integer max_epoch,cold_start,cold_clocks,anchor,epoch_tag,epoch_start,planned_start;
    integer first_finish,first_clocks,epoch_clocks,max_clocks,misses,start_late;
    integer reads_before,writes_before,hits_before,operands_before,states_before;
    integer mutation_count,mutation_epoch,mutation_period,mutation_address[0:31],mutation_word[0:31];
    integer overlap_before,live_checkpoint_before,last_batch_base;
    integer planned_upload_end,clear_start,clear_clocks;
    reg first_report=1,first_epoch_report;

    initial begin
        if($value$plusargs("TRACE=%s",trace_path)) begin end
        if($value$plusargs("REPORT=%s",report_path)) begin end
        trace_file=$fopen(trace_path,"r");report_file=$fopen(report_path,"w");
        if(!trace_file || !report_file) $fatal(1,"Cannot open integrated vectors/report");
        scan=$fscanf(trace_file,"%d",scenario_count);
        if(scan!=1) $fatal(1,"Missing integrated source catalogue");
        for(integer w=0;w<RAM_WORDS;w=w+1) expected_words[w]=0;
        repeat(20) @(negedge clk);clear_start=cycle;store_reset_n=1;power_reset_n=1;
        wait(memory_ready);@(negedge clk);clear_clocks=cycle-clear_start;checking=1;
        $fwrite(report_file,"{\"scope\":\"Actual eight-stereo BADP decoder, canonical checkpoints, atomic admitted-batch upload service and epoch snapshots through real sample-store/ISSI pins; external FIFO data availability, SYS/DMA admission, complete APU mixer and silicon timing are not qualified. Staging copies externally held admitted data before its fixed deadline. Cold preparation, every first output and missed deadlines remain explicit.\",\"frame_clocks\":768,\"physical_reset_clear_clocks\":%0d,\"scenarios\":[",clear_clocks);
        for(integer s=0;s<scenario_count;s=s+1) begin
            scan=$fscanf(trace_file,"%s %d %d %d",scenario_name,source_words,voices,event_count);
            if(scan!=4 || source_words>RAM_WORDS || voices!=8 || event_count>MAX_EVENTS) $fatal(1,"Incomplete integrated fixture header");
            selected=scenario_name=="eight_loop0_256_half" || scenario_name=="eight_loop0_512_half" ||
                scenario_name=="eight_loop33_97_half" || scenario_name=="eight_forward_b1_39write_capacity" ||
                scenario_name=="eight_forward_b256_39write_capacity" || scenario_name=="eight_half_loop_postcommit_mixed_prefix" ||
                scenario_name=="eight_two_frame_loop_overlapping_commit";
            for(integer w=0;w<source_words;w=w+1) begin
                scan=$fscanf(trace_file,"%h",image_word);if(scan!=1) $fatal(1,"Incomplete integrated image");
                if(selected) begin expected_words[w]=image_word;device.words[w*2]=image_word[15:0];device.words[w*2+1]=image_word[31:16];end
            end
            for(integer v=0;v<8;v=v+1) for(integer f=0;f<9;f=f+1) begin
                scan=$fscanf(trace_file,"%d",scan_word);if(scan!=1) $fatal(1,"Incomplete integrated descriptor");
                descriptors[v][f]=scan_word;
            end
            max_epoch=0;mutation_count=0;
            for(integer e=0;e<event_count;e=e+1) begin
                for(integer f=0;f<24;f=f+1) begin
                    scan=$fscanf(trace_file,"%d",scan_word);if(scan!=1) $fatal(1,"Incomplete integrated event");
                    events[e][f]=scan_word;
                end
                if(events[e][1]>max_epoch) max_epoch=events[e][1];
            end
            if(selected) begin
                total_cases=total_cases+1;driver_enabled=0;reset_n=0;stage_valid=0;start_valid=0;
                epoch_begin=0;epoch_end=0;repeat(2) @(negedge clk);reset_n=1;
                for(integer w=130816;w<RAM_WORDS;w=w+1) begin
                    expected_words[w]=0;device.words[w*2]=0;device.words[w*2+1]=0;
                end
                for(integer v=0;v<8;v=v+1) begin
                    bind_valid=1;bind_voice=v;bind_source_base=descriptors[v][1];
                    bind_source_bytes=v==7 ? source_words*4-256-descriptors[v][1] : descriptors[v+1][1]-descriptors[v][1];
                    bind_data_offset=descriptors[v][2];bind_frames=descriptors[v][3];bind_channels=descriptors[v][4];
                    bind_seek_base=descriptors[v][5];bind_seek_count=descriptors[v][6];
                    bind_loop_start=descriptors[v][7];bind_loop_end=descriptors[v][8];@(negedge clk);
                end
                bind_valid=0;
                overlapping=scenario_name=="eight_half_loop_postcommit_mixed_prefix" || scenario_name=="eight_two_frame_loop_overlapping_commit";
                variable_batches=scenario_name=="eight_forward_b1_39write_capacity" || scenario_name=="eight_forward_b256_39write_capacity";
                if(overlapping) for(integer e=0;e<event_count;e=e+1) if(events[e][0]==3) begin
                    if(events[e][4]!=15 || mutation_count==32) $fatal(1,"Overlap fixture lacks full-word writes");
                    if(mutation_count!=0 && events[e][1]!=mutation_epoch) $fatal(1,"Overlap fixture has multiple mutation epochs");
                    mutation_epoch=events[e][1];
                    mutation_address[mutation_count]=events[e][3]>>2;mutation_word[mutation_count]=events[e][5];mutation_count=mutation_count+1;
                end
                for(integer n=0;n<16;n=n+1) begin
                    stage_valid=1;stage_index=n;stage_word=overlapping ? mutation_word[0] : 32'h11223344+n;@(negedge clk);
                end
                stage_valid=0;reads_before=physical_reads;writes_before=physical_writes;hits_before=checkpoint_hits;
                operands_before=operands;states_before=state_checks;cold_start=cycle;event_index=0;
                while(event_index<event_count && events[event_index][1]<0) begin
                    if(events[event_index][0]!=0) $fatal(1,"Integrated cold fixture is not a RESET");
                    request_frame(events[event_index][2],1,events[event_index][3],0,0);
                    check_context(events[event_index][2],event_index);event_index=event_index+1;
                end
                cold_clocks=cycle-cold_start;anchor=cycle+4;upload_count=0;offers=0;rejected=0;
                publications=0;published_words=0;peak_queue=0;near_epoch_commits=0;inflight_index=-1;
                overlap_before=overlapping_epoch_publications;
                live_checkpoint_before=live_checkpoint_epoch_publications;
                if(overlapping) begin
                    mutation_period=scenario_name=="eight_two_frame_loop_overlapping_commit" ? 33 : 32;
                    if(mutation_count!=(mutation_period==33 ? 16 : 8)) $fatal(1,"Missing overlap mutations");
                    if(mutation_period==33) begin
                        for(integer n=0;n<14;n=n+1)
                            add_upload(anchor+mutation_epoch*768-352-16-32-(13-n)*33,1,mutation_address[n],mutation_word[n]);
                        last_batch_base=mutation_address[14]<mutation_address[15] ? mutation_address[14] : mutation_address[15];
                        if((mutation_address[14]>mutation_address[15] ? mutation_address[14] : mutation_address[15])-last_batch_base!=10)
                            $fatal(1,"Expected voice7 mutations to span eleven native words");
                        add_upload(anchor+mutation_epoch*768-352,11,last_batch_base,0);
                        for(integer j=0;j<11;j=j+1) upload_data[upload_count-1][j]=expected_words[last_batch_base+j];
                        upload_data[upload_count-1][mutation_address[14]-last_batch_base]=mutation_word[14];
                        upload_data[upload_count-1][mutation_address[15]-last_batch_base]=mutation_word[15];
                    end else for(integer n=0;n<mutation_count;n=n+1) begin
                        if(mutation_word[n]!==mutation_word[0]) $fatal(1,"Back-to-back single-word fixture changes pending staging");
                        add_upload(anchor+mutation_epoch*768-32-(mutation_count-1-n)*32,1,mutation_address[n],mutation_word[n]);
                    end
                    for(integer t=anchor+mutation_epoch*768+32;t<anchor+(max_epoch+1)*768;t=t+512)
                        add_upload(t,16,130816,32'h11223344);
                end else if(variable_batches) begin
                    add_upload(anchor,16,130816,32'h11223344);
                    add_upload(anchor+512,16,130832,32'h11223344);
                    add_upload(anchor+1024,7,130848,32'h11223344);
                    for(integer t=anchor+1248;t<anchor+(max_epoch+1)*768;t=t+512)
                        add_upload(t,16,130816,32'h11223344);
                end else for(integer t=anchor+256;t<anchor+(max_epoch+1)*768;t=t+512)
                    add_upload(t,16,130816,32'h11223344);
                planned_upload_end=upload_start[upload_count-1]+32*upload_size[upload_count-1];
                driver_enabled=1;epoch_tag=-1;first_clocks=0;first_finish=0;max_clocks=0;misses=0;first_epoch_report=1;
                if(!first_report) $fwrite(report_file,",");first_report=0;
                $fwrite(report_file,"{\"id\":\"%s\",\"voices\":8,\"cold_reset_clocks\":%0d,\"upload_pattern\":\"%s\",\"output_epochs\":[",scenario_name,cold_clocks,overlapping ? "timed_overlap_batches_then_fixed16" : variable_batches ? "16_16_7_then_fixed16" : "fixed16");
                while(event_index<event_count) begin
                    if(events[event_index][0]==3) begin
                        // Golden writes become real timed batches above. The
                        // static capacity fixtures write only disjoint bytes.
                        event_index=event_index+1;
                    end else begin
                        if(events[event_index][1]!=epoch_tag) begin
                            if(epoch_tag>=0) finish_epoch();
                            epoch_tag=events[event_index][1];planned_start=anchor+epoch_tag*768;
                            while(cycle<planned_start-1) @(negedge clk);
                            epoch_begin=1;
                            @(posedge clk);#0.01;epoch_start=cycle;
                            @(negedge clk);epoch_begin=0;
                        end
                        case(events[event_index][0])
                            0: request_frame(events[event_index][2],1,events[event_index][3],0,0);
                            1: request_frame(events[event_index][2],0,events[event_index][3],1,events[event_index][6]);
                            2: begin
                                request_frame(events[event_index][2],0,events[event_index][3],1,events[event_index][6]);
                                if(events[event_index][4]!=events[event_index][3]) request_frame(events[event_index][2],0,events[event_index][4],1,events[event_index][7]);
                            end
                            default: $fatal(1,"Unknown integrated request event");
                        endcase
                        check_context(events[event_index][2],event_index);event_index=event_index+1;
                    end
                end
                finish_epoch();
                while(cycle<=planned_upload_end || batch_busy || queued_words!=0 || word_active) @(negedge clk);
                driver_enabled=0;stage_valid=0;start_valid=0;
                if(offers!=upload_count || publications!=offers-rejected || physical_writes-writes_before!=published_words)
                    $fatal(1,"Integrated arrival/publication/drain accounting lost an offered batch");
                if(mutation_period==33 && overlapping && live_checkpoint_epoch_publications==live_checkpoint_before)
                    $fatal(1,"Same-edge overlap invalidation did not encounter a previously valid canonical checkpoint");
                $fwrite(report_file,"],\"first_output_clocks\":%0d,\"cold_plus_first_output_clocks\":%0d,\"cold_to_first_epoch_gap_clocks\":4,\"maximum_render_clocks\":%0d,\"deadline_misses\":%0d,\"offered_batch_starts\":%0d,\"unaccepted_batch_starts\":%0d,\"published_batches\":%0d,\"published_words\":%0d,\"peak_queued_words\":%0d,\"publication_and_epoch_begin_same_edge\":%0d,\"overlapping_publication_and_epoch_begin_same_edge\":%0d,\"physical_reads\":%0d,\"physical_writes\":%0d,\"native_pin_word_checks\":true,\"checkpoint_hits\":%0d,\"operand_checks\":%0d,\"raw_state_checks\":%0d,\"specified_global_arrivals\":[",first_clocks,first_finish-cold_start,max_clocks,misses,offers,rejected,publications,published_words,peak_queue,near_epoch_commits,overlapping_epoch_publications-overlap_before,physical_reads-reads_before,physical_writes-writes_before,checkpoint_hits-hits_before,operands-operands_before,state_checks-states_before);
                for(integer b=0;b<upload_count;b=b+1) begin
                    if(b!=0) $fwrite(report_file,",");
                    $fwrite(report_file,"{\"start_relative_cycle\":%0d,\"due_relative_cycle\":%0d,\"words\":%0d,\"base_word\":%0d,\"accepted\":%0d}",upload_start[b]-anchor,upload_start[b]+32*upload_size[b]-anchor,upload_size[b],upload_base[b],upload_accepted[b]);
                end
                $fwrite(report_file,"],\"live_checkpoint_same_edge_invalidations\":%0d,\"global_publications\":[",live_checkpoint_epoch_publications-live_checkpoint_before);
                for(integer b=0;b<publications;b=b+1) begin
                    if(b!=0) $fwrite(report_file,",");
                    $fwrite(report_file,"{\"relative_cycle\":%0d,\"words\":%0d,\"base_word\":%0d}",publication_cycle[b]-anchor,upload_size[publication_batch[b]],upload_base[publication_batch[b]]);
                end
                $fwrite(report_file,"]}");
                $display("BADP_UPLOAD %s cold=%0d first=%0d peak=%0d misses=%0d publications=%0d words=%0d rejected=%0d",scenario_name,cold_clocks,first_clocks,max_clocks,misses,publications,published_words,rejected);
            end
        end
        if(total_cases!=7 || simultaneous_epoch_publications==0 || overlapping_epoch_publications==0 || live_checkpoint_epoch_publications==0)
            $fatal(1,"Missing integrated case or true overlapping due-edge epoch coincidence");
        $fdisplay(report_file,"],\"total_scenarios\":%0d,\"total_output_epochs\":%0d,\"total_deadline_misses\":%0d,\"total_offered_starts\":%0d,\"total_unaccepted_starts\":%0d,\"total_published_batches\":%0d,\"total_published_words\":%0d,\"physical_reads\":%0d,\"physical_writes\":%0d,\"forwarded_read_requests\":%0d,\"same_edge_epoch_publications\":%0d,\"overlapping_same_edge_epoch_publications\":%0d,\"live_checkpoint_same_edge_invalidations\":%0d,\"operand_checks\":%0d,\"raw_state_checks\":%0d}",total_cases,total_epochs,total_misses,total_offers,total_rejected,total_publications,total_published_words,physical_reads,physical_writes,total_forwarded_reads,simultaneous_epoch_publications,overlapping_epoch_publications,live_checkpoint_epoch_publications,operands,state_checks);
        $fclose(trace_file);$fclose(report_file);
        $display("PASS apu_badp_upload: %0d eight-stereo scenarios, %0d epochs, %0d physical reads/%0d writes, %0d global batches; misses=%0d rejected starts=%0d",total_cases,total_epochs,physical_reads,physical_writes,total_publications,total_misses,total_rejected);
        $finish;
    end
    task automatic finish_epoch;
        begin
            epoch_clocks=cycle-epoch_start;start_late=epoch_start-planned_start;
            if(!first_epoch_report) $fwrite(report_file,",");first_epoch_report=0;
            $fwrite(report_file,"{\"epoch\":%0d,\"render_clocks\":%0d,\"start_lateness_clocks\":%0d,\"finish_lateness_clocks\":%0d,\"deadline_missed\":%0d}",epoch_tag,epoch_clocks,start_late,cycle>planned_start+768 ? cycle-planned_start-768 : 0,cycle>planned_start+768);
            if(epoch_tag==0) begin first_clocks=epoch_clocks;first_finish=cycle;end
            if(epoch_clocks>max_clocks) max_clocks=epoch_clocks;
            if(cycle>planned_start+768) begin misses=misses+1;total_misses=total_misses+1;end
            total_epochs=total_epochs+1;
            @(negedge clk);epoch_end=1;@(negedge clk);epoch_end=0;
        end
    endtask
    initial begin #1000000000;$fatal(1,"Integrated BADP upload watchdog");end
endmodule
