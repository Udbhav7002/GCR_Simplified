use std::time::Duration;
use tokio::time::sleep;

/// Retries an asynchronous function with exponential backoff.
/// 
/// `max_retries`: Maximum number of times to retry (e.g., 3 for a total of 4 attempts).
/// `base_delay`: Initial delay before the first retry.
/// `f`: A closure returning a Future that yields `Result<T, E>`.
pub async fn with_retry<T, E, F, Fut>(
    max_retries: u32,
    base_delay: Duration,
    mut f: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut attempt = 0;
    loop {
        match f().await {
            Ok(val) => return Ok(val),
            Err(e) => {
                if attempt >= max_retries {
                    return Err(e);
                }
                
                // Exponential backoff: base_delay * 2^attempt
                let backoff_duration = base_delay * 2_u32.pow(attempt);
                log::warn!("Operation failed. Retrying {}/{} in {:?}...", attempt + 1, max_retries, backoff_duration);
                sleep(backoff_duration).await;
                
                attempt += 1;
            }
        }
    }
}
