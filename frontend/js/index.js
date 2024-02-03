import Worker from "worker-loader!./worker.js";
import { get_update_threshold } from "./exports";

const wasm = import("../pkg/index").then((wasm) => {
    function processFile (files) {
        const wasmProcess = new Worker();

        let status = document.getElementById('status');
        status.classList.remove('alert', 'alert-danger', 'alert-dismissible', 'fade', 'show'); //remove alert status if it exists

        console.info("Extracting compositions.")
        
        let finished = function (result) {
            if (result.err) {
                status.innerText = `Error encountered while processing:\n${result.err}`;
                status.classList.add('alert', 'alert-danger', 'alert-dismissible', 'fade', 'show');
                loading(false); //remove loading part

                throw new Error("Script panic'ed.");

            } else {
                status.innerText = "Waiting on server response... May take up to 5 minutes."; //display waiting message
                console.info("Extracted compositions.")
                async function fetch_plot (compositions) {
                    console.info("Fetching plots.")

                    //download and display plots
                    let data = await fetch ('api/plot_comp', {
                        headers:{
                            "content-type":"application/json"
                        },
                        body:JSON.stringify(compositions),
                        method:"POST"
                    });
                    console.info("Fetched plots.")

                    loading(false); //remove loading part

                    if (data.ok) {
                        //remove status to display results
                        status.innerText = '';
                        status.classList.add('d-none');
                        document.getElementById('samples_table').classList.remove('d-none');

                        let plots = await data.json();

                        // Define plot legends and height
                        let legend = {
                            compositions_map: 'UMAP representation of compositions of published sequencing data. Different library types are indicated by colours. Compositions of test libraries are projected onto the same manifold and indicated by black circles.',
                            probability_maps: 'This collection of maps shows the probability of a particular region of the map to correspond to a certain library type. The darker the colour, the more dominated the region is by the indicated library type. The location of test libraries is indicated by a light blue circle.',
                            prediction_plot: 'For each projected test library, the location on the Reference/Probability Map is determined. This plot shows how published library types are represented at the same location.'
                        };
                        let plot_height = {
                            compositions_map: '550px',
                            probability_maps: '600px',
                            prediction_plot: '500px'
                        };

                        //display plots
                        for (let plt of plots) {
                            let filename = plt.filename;
                            let [name, ext] = filename.split('.');

                            // only display svg plots
                            if (ext !== "svg") {
                                continue;
                            }

                            let plot = plt.plot;
                            let link = `data:image/svg+xml;base64,` + plot;
                            let img = document.createElement('img');
                            img.src = link;
                            img.id = filename; //set id as filename
                            img.classList.add('plot', 'img-fluid', 'mx-auto', 'd-block');

                            img.style.height = plot_height[name];

                            let label = legend[name];
                            let p = document.createElement('p');
                            let textNode = document.createTextNode(label);
                            if(name == 'prediction_plot'){
                                p.classList.add('mt-4');
                            }

                            p.appendChild(textNode);

                            let div = document.createElement('div');
                            div.classList.add('h-100', 'col-md-12');
                            if(name == 'prediction_plot'){
                                div.classList.add('mt-5');
                            }

                            div.appendChild(img);
                            div.appendChild(p);
                            document.getElementById('plots').appendChild(div);

                            let hr = document.createElement('hr');
                            hr.classList.add('w-50');
                            document.getElementById('plots').appendChild(hr);
                        }

                        document.getElementById('download_plots').onclick = () => {download_plots(plots)};
                        document.getElementById('download_plots').classList.remove('d-none'); //display the downloads button


                        // Fill the samples table
                        let res = result['out'];
                        let table = document.getElementById('samples_tbody');

                        for (let i = 0; i < res.length; i++){
                            let row = table.insertRow();
                            let number = res[i]['idx'];
                            if(number < 10){
                                number = '0' + number;
                            }
                            row.insertCell(0).innerHTML = res[i]['name'];
                            row.insertCell(1).innerHTML = number;
                        }

                        document.getElementById('interpretation').classList.remove('d-none');

                    } else {
                        status.innerText = 'Error from server response. Press F12 and look at console for more information.';
                        status.classList.add('alert', 'alert-danger', 'alert-dismissible', 'fade', 'show');
                        throw data;
                    }
                }

                let smaller_reads = result.out.map((e, i) => {e.idx = i + 1; return e;}).filter(e => e.reads_read < 100000);

                if (smaller_reads.length != 0) {
                    status.innerText = `Fewer valid reads (${smaller_reads.map(e => ` ${e.reads_read} in sample ${e.idx}`)}) than recommended (100000)
                    (this may be due to reads being filtered out due to being shorter than 50 bases)`;
                    status.classList.add('alert', 'alert-danger', 'alert-dismissible', 'fade', 'show');
                    loading(false); //remove loading part

                    throw new Error("Reads too short");
                }

                fetch_plot(result.out);
            }
        }

        wasmProcess.onmessage = (msg) => {
            let e = msg.data;
            if (e.type == "finished") {
                document.getElementById('progress').classList.add('d-none');
                finished(e);
            }
            else if (e.type == "next_file") {
                document.getElementById('progress-file').innerText = `Processing ${e.file.name}`;
                document.getElementById('progressbar').value = 0;
                let chunk_size = Number(get_update_threshold());
                document.getElementById('progressbar').max = (e.file.size / chunk_size);
            } else if (e.type == "progress") {
                document.getElementById('progressbar').value += e.amount;
            }
        };

        document.getElementById('progress').classList.remove('d-none'); //display the progress bar
        wasmProcess.postMessage (files);
    }

    // Prepare the page before running a file
    function setupPage(){
        loading(true);

        //display the result part and the status information
        document.getElementById('result').classList.remove('d-none');
        document.getElementById('status').classList.remove('d-none');

        document.getElementById('download_plots').onclick = () => {console.info("Download plots not initialized yet!")};
        document.getElementById('download_plots').classList.add('d-none'); //hide the downloads plots button

        //remove previous results plots if exists
        let plots = document.getElementById('plots');
        while (plots.firstChild) {
            plots.removeChild(plots.firstChild);
        }

        document.getElementById('samples_table').classList.add('d-none');
        let table = document.getElementById('samples_table');
        let row = table.getElementsByTagName('tbody')[0];
        row.innerHTML = '';
    }


    // Hide/display some element after/before loading
    function loading(disabled){
        //disabled the run button to avoid multiple launches
        document.getElementById('run').disabled = disabled;
        document.getElementById('file_selector').disabled = disabled;
    }


    //run the tool
    function run() {
        setupPage() //prepare the page
        const fileSelector = document.getElementById('file_selector');
        processFile(fileSelector.files);
    }

    let runBtn = document.getElementById('run');

    document.getElementById('file_selector').addEventListener('change', (e) => {
        runBtn.classList.remove('d-none');
    }) //on file change

    runBtn.addEventListener('click', run); //on run button

    //add event listener on downloads buttons (files and plots)
    document.getElementById('download_files').addEventListener('click', download_files);


    // Download input files
    function download_files() {
        fetch("example_inputs/example_inputs.zip").then(function(t) {
            return t.blob().then((b)=>{
                let a = document.createElement("a");
                a.href = URL.createObjectURL(b);
                a.setAttribute("download", "example_inputs.zip");
                a.click();
            });
        });
    }
    
    
    //Convert HTML table into csv file
    function table_to_csv(id) {
      let csv_data = [];
        // Get each row data
        let rows = document.getElementById(id).getElementsByTagName('tr');
        for (let i = 0; i < rows.length; i++) {
          let cols = rows[i].querySelectorAll('td,th');
          let csv_row = [];
          for (let j = 0; j < cols.length; j++) {
            csv_row.push(cols[j].innerHTML);
          }
          csv_data.push(csv_row.join(","));
        }
        
        csv_data = csv_data.join('\n');
        return csv_data; 
    }


    // Download output plots in a .zip
    function download_plots(plots) {
        console.log("button click");
        
        let zip = new JSZip();
        let zipFilename = "Librarian_plots.zip";
        
        //Retrieve samples assignment table
        let csv_data = table_to_csv('samples_table');
        zip.file('samples_assignment.csv', csv_data, {binary:true});
        
        plots.forEach(function(plot){
            zip.file(plot.filename, plot.plot, {base64:true});
        });

        zip.generateAsync({type:'blob'}).then(function(content) {
            saveAs(content, zipFilename);
        });
    }
})
