/*
Currently, test responses take around 6-7 seconds, which is far longer than the recommended 500 ms.
Since this is a long-running calculation, consider using this advice:
https://docs.microsoft.com/en-us/azure/architecture/patterns/async-request-reply
*/

use actix_files::Files;
use actix_web::{error, middleware, post, web, App, HttpResponse, HttpServer};

use log::{self, warn, debug};
use serde_json::to_vec;
use simple_logger::SimpleLogger;
use std::{env, fmt::Debug, path::PathBuf, str::FromStr};

use server::{plot_comp, FileComp};

#[post("/api/plot_comp")]
async fn plot(comp: web::Json<Vec<FileComp>>) -> Result<HttpResponse, error::Error> {
    let plots = web::block(move || plot_comp(comp.into_inner())).await??;

    debug!("Plots: {:?}", &plots.iter().map(|p| &p.filename).collect::<Vec<_>>());
    if plots.is_empty() {
        warn!("No plots found in temp folder!");
    }

    Ok(HttpResponse::Ok()
        .content_type("application/json")
        .body(to_vec(&plots).unwrap()))
}

fn get_env_or_default<K, S>(key: K, default: S) -> S
where
    K: AsRef<std::ffi::OsStr> + Debug,
    S: FromStr + Debug,
{
    env::var(&key)
        .ok()
        .and_then(|val| val.parse().ok())
        .unwrap_or_else(|| {
            warn!("{:?} not found, using default value {:?}", &key, default);
            default
        })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    eprintln!("Starting application");

    SimpleLogger::new()
        .with_utc_timestamps()
        .with_colors(true)
        .with_level(log::LevelFilter::Info)
        .env()
        .init()
        .unwrap();

    let frontend_index: PathBuf =
        get_env_or_default("LIBRARIAN_INDEX_PATH", "../frontend/dist".into());
    let example_input: PathBuf =
        get_env_or_default("LIBRARIAN_EXAMPLE_PATH", "../frontend/example_inputs".into());

    HttpServer::new(move || {
        App::new()
            .wrap(middleware::Logger::default())
            .service(plot)
            .service(Files::new("/example_inputs", &example_input).prefer_utf8(true))
            .service(
                Files::new("/", &frontend_index)
                    .index_file("index.html")
                    .prefer_utf8(true),
            )
    })
    .bind(("0.0.0.0", get_env_or_default("LIBRARIAN_PORT", 8186)))?
    .run()
    .await
}
