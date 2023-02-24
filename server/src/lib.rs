use fastq2comp::BaseComp;
use log::{self, debug, log_enabled, trace, warn, error};
use std::{
    fs::{read_dir, File},
    io::{Read, Write},
    process::{Command, Stdio},
    fmt::Write as _,
};
use thiserror::Error;

const R_SCRIPT_PATH: &str = "scripts/librarian_plotting_test_samples_server_220623.R";

#[derive(Debug, Error)]
pub enum PlotError {
    #[error("R script exited unsuccessfully")]
    RExit,
    #[error("Error opening directory")]
    DirErr(#[from] std::io::Error),
}

impl actix_web::error::ResponseError for PlotError {}

use serde::{Deserialize, Serialize};
/// Describes a plot; which has a filename and data.
#[derive(Serialize, Deserialize)]
pub struct Plot {
    /// Raw plot data - in svg
    // since it's svg, we'll be safe in using a String
    pub plot: String,
    pub filename: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Sample {
    #[serde(flatten)]
    pub comp: BaseComp,
    pub name: String
}

impl std::fmt::Debug for Plot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.filename.fmt(f)
    }
}

pub fn plot_comp(comp: Vec<Sample>) -> Result<Vec<Plot>, PlotError> {
    assert!(!comp.is_empty());

    let mut input = String::new();

    for c in comp.into_iter() {
        write!(&mut input, "{}\t", c.name).unwrap(); // this unwrap never fails
        c.comp.lib
            .into_iter()
            .flat_map(|b| b.bases.iter())
            .for_each(|curr| input.push_str(&(curr.to_string() + "\t")));
        input.pop(); // remove trailing '\t' to make it valid tsv
        input.push('\n');
    }
    trace!("Input: {:?}", &input);

    let tmpdir = String::from_utf8_lossy(
        &Command::new("mktemp")
            .arg("-d")
            .output()
            .expect("Temporary file creation failed.")
            .stdout, // removes the \n which mktemp appends
    )
    .to_string()
    .split('\n')
    .next()
    .unwrap()
    .to_owned();

    debug!("Tempdir: {:?}", tmpdir);

    let mut child = Command::new("Rscript")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr({
            if log_enabled!(log::Level::Debug) {
                Stdio::inherit()
            } else {
                Stdio::null()
            }
        })
        .arg(R_SCRIPT_PATH)
        .arg("--args")
        .arg(&tmpdir)
        .spawn()
        .expect("Failed to spawn child process");

    let mut stdin = child.stdin.take().expect("Failed to open stdin");

    std::thread::spawn(move || {
        stdin
            .write_all(input.as_bytes())
            .expect("Failed to write to stdin")
    });

    let exit_status = child.wait().expect("Error waiting on child to exit.");
    if !exit_status.success() {
        error!("Rscript failed with status {}", exit_status);
        return Err(PlotError::RExit);
    };

    debug!("Child executed successfuly.");

    let out_arr = read_dir(&tmpdir)?
        .filter_map(|e| {
            if e.is_err() {
                warn!("Error iterating over dir {:?}, skipping file.", &tmpdir)
            };
            e.ok()
        })
        .filter_map(|e| {
            let filename = e.file_name().to_string_lossy().to_string();
            let f = File::open(e.path());
            if f.is_err() {
                warn!("Error opening file {:?} due to error {:?}", e.path(), &f);
                return None;
            };
            let mut buf = String::new();
            if let Err(err) = f.unwrap().read_to_string(&mut buf) {
                warn!("Error reading file {:?} due to error {:?}", e.path(), err);
                return None;
            }
            Some(Plot {
                plot: buf,
                filename,
            })
        })
        .collect::<Vec<_>>();

    trace!("Deleting files.");
    std::fs::remove_dir_all(&tmpdir).expect("Error deleting tmpfile.");

    Ok(out_arr)
}
