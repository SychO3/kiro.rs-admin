//! Webshare 代理 API 集成
//!
//! 自动从 Webshare 同步代理列表到本地代理池，
//! 支持风控触发时通过 Replace API 自动替换 IP。

use super::proxy_pool::ProxyPoolManager;
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

const WEBSHARE_LIST_URL: &str = "https://proxy.webshare.io/api/v2/proxy/list/";
const WEBSHARE_REPLACE_URL: &str = "https://proxy.webshare.io/api/v3/proxy/replace/";
const REPLACE_POLL_INTERVAL: Duration = Duration::from_secs(3);
const REPLACE_POLL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize)]
struct ListResponse {
    results: Vec<WebshareProxy>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WebshareProxy {
    pub proxy_address: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub country_code: String,
    pub city_name: String,
}

impl WebshareProxy {
    pub fn to_url(&self) -> String {
        format!(
            "http://{}:{}@{}:{}",
            self.username, self.password, self.proxy_address, self.port
        )
    }

    pub fn label(&self) -> String {
        format!("WS-{}-{}", self.country_code, self.city_name)
    }
}

#[derive(Debug, Deserialize)]
struct ReplaceResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ReplaceStatus {
    state: String,
}

pub struct WebshareClient {
    api_token: String,
    client: Client,
}

impl WebshareClient {
    pub fn new(api_token: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { api_token, client }
    }

    pub async fn list_proxies(&self) -> anyhow::Result<Vec<WebshareProxy>> {
        let resp = self
            .client
            .get(WEBSHARE_LIST_URL)
            .query(&[("mode", "direct"), ("page_size", "100")])
            .header("Authorization", format!("Token {}", self.api_token))
            .send()
            .await?;
        if !resp.status().is_success() {
            anyhow::bail!("Webshare list API 返回 {}", resp.status());
        }
        let data: ListResponse = resp.json().await?;
        Ok(data.results)
    }

    pub async fn replace_proxy(&self, ip: &str) -> anyhow::Result<()> {
        let body = serde_json::json!({
            "to_replace": {"type": "ip_address", "ip_addresses": [ip]},
            "replace_with": [{"type": "country", "country_code": "US"}]
        });
        let resp = self
            .client
            .post(WEBSHARE_REPLACE_URL)
            .header("Authorization", format!("Token {}", self.api_token))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Webshare replace API 返回 {}: {}", status, text);
        }
        let replace: ReplaceResponse = resp.json().await?;
        // 轮询直到完成
        let deadline = tokio::time::Instant::now() + REPLACE_POLL_TIMEOUT;
        loop {
            tokio::time::sleep(REPLACE_POLL_INTERVAL).await;
            if tokio::time::Instant::now() > deadline {
                anyhow::bail!("Webshare replace 超时（{}s）", REPLACE_POLL_TIMEOUT.as_secs());
            }
            let poll_url = format!("{}{}/", WEBSHARE_REPLACE_URL, replace.id);
            let poll_resp = self
                .client
                .get(&poll_url)
                .header("Authorization", format!("Token {}", self.api_token))
                .send()
                .await?;
            if poll_resp.status().is_success() {
                let status: ReplaceStatus = poll_resp.json().await?;
                if status.state == "completed" {
                    return Ok(());
                }
                if status.state != "validating" && status.state != "pending" {
                    anyhow::bail!("Webshare replace 失败，state={}", status.state);
                }
            }
        }
    }
}

/// 同步结果
#[derive(Debug, Default)]
pub struct SyncResult {
    pub added: usize,
    pub removed: usize,
    pub unchanged: usize,
}

/// 从 Webshare 拉取代理列表，与代理池做 diff 同步
pub async fn sync_to_pool(
    client: &WebshareClient,
    pool: &ProxyPoolManager,
) -> anyhow::Result<SyncResult> {
    let proxies = client.list_proxies().await?;
    let new_urls: Vec<(String, String)> = proxies
        .iter()
        .map(|p| (p.to_url(), p.label()))
        .collect();

    let existing = pool.list();
    let existing_urls: std::collections::HashSet<&str> =
        existing.iter().map(|e| e.url.as_str()).collect();
    let new_url_set: std::collections::HashSet<&str> =
        new_urls.iter().map(|(url, _)| url.as_str()).collect();

    let mut result = SyncResult::default();

    // 添加新代理
    for (url, label) in &new_urls {
        if !existing_urls.contains(url.as_str()) {
            if let Err(e) = pool.add(url.clone(), Some(label.clone())) {
                tracing::warn!("添加 Webshare 代理失败: {}", e);
            } else {
                result.added += 1;
            }
        } else {
            result.unchanged += 1;
        }
    }

    // 删除已不存在的 Webshare 代理（只删 WS- 开头的）
    for entry in &existing {
        let is_webshare = entry
            .label
            .as_deref()
            .map(|l| l.starts_with("WS-"))
            .unwrap_or(false);
        if is_webshare && !new_url_set.contains(entry.url.as_str()) {
            let _ = pool.delete(entry.id);
            result.removed += 1;
        }
    }

    Ok(result)
}

/// 替换指定代理池条目的 IP：调 Webshare Replace API 后重新同步
pub async fn replace_and_sync(
    client: &WebshareClient,
    pool: &ProxyPoolManager,
    proxy_id: u64,
) -> anyhow::Result<SyncResult> {
    // 从池中找到该代理的 IP
    let entry = pool.list().into_iter().find(|e| e.id == proxy_id);
    let entry = entry.ok_or_else(|| anyhow::anyhow!("代理 #{} 不存在", proxy_id))?;
    let ip = extract_ip_from_url(&entry.url)
        .ok_or_else(|| anyhow::anyhow!("无法从 URL 提取 IP: {}", entry.url))?;

    tracing::info!(proxy_id, ip = %ip, "调用 Webshare Replace API 替换代理");
    client.replace_proxy(&ip).await?;
    tracing::info!(proxy_id, "Webshare 替换完成，开始重新同步");
    sync_to_pool(client, pool).await
}

fn extract_ip_from_url(url: &str) -> Option<String> {
    // http://user:pass@1.2.3.4:8080 → 1.2.3.4
    let after_at = url.split('@').nth(1)?;
    let host_port = after_at.split('/').next()?;
    let host = host_port.rsplit(':').last()?;
    Some(host.to_string())
}

/// 后台定时同步任务
pub fn spawn_background_sync(
    api_token: String,
    interval_secs: u64,
    pool: Arc<ProxyPoolManager>,
) {
    tokio::spawn(async move {
        let client = WebshareClient::new(api_token);
        // 首次立即同步
        match sync_to_pool(&client, &pool).await {
            Ok(r) => tracing::info!(
                "Webshare 首次同步完成：新增 {}，删除 {}，不变 {}",
                r.added, r.removed, r.unchanged
            ),
            Err(e) => tracing::error!("Webshare 首次同步失败：{}", e),
        }
        let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
        interval.tick().await; // 跳过首个立即触发
        loop {
            interval.tick().await;
            match sync_to_pool(&client, &pool).await {
                Ok(r) => {
                    if r.added > 0 || r.removed > 0 {
                        tracing::info!(
                            "Webshare 定时同步：新增 {}，删除 {}",
                            r.added, r.removed
                        );
                    }
                }
                Err(e) => tracing::warn!("Webshare 定时同步失败：{}", e),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_ip() {
        assert_eq!(
            extract_ip_from_url("http://user:pass@1.2.3.4:8080"),
            Some("1.2.3.4".to_string())
        );
        assert_eq!(
            extract_ip_from_url("http://u:p@10.0.0.1:3128/"),
            Some("10.0.0.1".to_string())
        );
    }

    #[test]
    fn proxy_to_url() {
        let p = WebshareProxy {
            proxy_address: "1.2.3.4".into(),
            port: 8080,
            username: "user".into(),
            password: "pass".into(),
            country_code: "US".into(),
            city_name: "Seattle".into(),
        };
        assert_eq!(p.to_url(), "http://user:pass@1.2.3.4:8080");
        assert_eq!(p.label(), "WS-US-Seattle");
    }
}
