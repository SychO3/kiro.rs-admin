//! Token 计算模块
//!
//! 使用 tiktoken BPE 编码（cl100k_base）精确计算 token 数量。
//! Claude 模型的 tokenizer 与 cl100k_base 接近，乘以 1.15 修正系数。

use crate::anthropic::types::{
    CountTokensRequest, CountTokensResponse, Message, SystemMessage, Tool,
};
use crate::http_client::{ProxyConfig, build_client};
use crate::model::config::TlsBackend;
use std::sync::OnceLock;

/// Claude 模型相对 cl100k_base 的修正系数
const CLAUDE_CORRECTION_FACTOR: f64 = 1.15;

/// 全局定价表句柄（启动时由 main 注入）。未初始化时 `calculate_cost` 返回 0。
static PRICING_TABLE: OnceLock<crate::model::pricing::SharedPricing> = OnceLock::new();

/// 注入全局定价表（main 启动时调用一次）
pub fn set_pricing_table(table: crate::model::pricing::SharedPricing) {
    let _ = PRICING_TABLE.set(table);
}

/// 根据模型和 token 用量按定价表计算费用（USD）
pub fn calculate_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
) -> f64 {
    let Some(table) = PRICING_TABLE.get() else {
        return 0.0;
    };
    crate::model::pricing::calculate_cost(
        table,
        model,
        input_tokens,
        output_tokens,
        cache_creation_tokens,
        cache_read_tokens,
    )
    .unwrap_or(0.0)
}

/// Count Tokens API 配置
#[derive(Clone, Default)]
pub struct CountTokensConfig {
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub auth_type: String,
    pub proxy: Option<ProxyConfig>,
    pub tls_backend: TlsBackend,
}

static COUNT_TOKENS_CONFIG: OnceLock<CountTokensConfig> = OnceLock::new();

pub fn init_config(config: CountTokensConfig) {
    let _ = COUNT_TOKENS_CONFIG.set(config);
}

fn get_config() -> Option<&'static CountTokensConfig> {
    COUNT_TOKENS_CONFIG.get()
}

fn encoder() -> &'static tiktoken::CoreBpe {
    tiktoken::get_encoding("cl100k_base").expect("cl100k_base encoding")
}

/// 计算文本的 token 数量（BPE 编码 + Claude 修正）
pub fn count_tokens(text: &str) -> u64 {
    let raw = encoder().count(text);
    (raw as f64 * CLAUDE_CORRECTION_FACTOR).ceil() as u64
}

/// 估算请求的输入 tokens（优先远程 API，回退本地 BPE）
pub(crate) fn count_all_tokens(
    model: String,
    system: Option<Vec<SystemMessage>>,
    messages: Vec<Message>,
    tools: Option<Vec<Tool>>,
) -> u64 {
    if let Some(config) = get_config() {
        if let Some(api_url) = &config.api_url {
            let result = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(call_remote_count_tokens(
                    api_url, config, model, &system, &messages, &tools,
                ))
            });
            match result {
                Ok(tokens) => {
                    tracing::debug!("远程 count_tokens API 返回: {}", tokens);
                    return tokens;
                }
                Err(e) => {
                    tracing::warn!("远程 count_tokens API 调用失败，回退到本地计算: {}", e);
                }
            }
        }
    }
    count_all_tokens_local(system, messages, tools)
}

async fn call_remote_count_tokens(
    api_url: &str,
    config: &CountTokensConfig,
    model: String,
    system: &Option<Vec<SystemMessage>>,
    messages: &[Message],
    tools: &Option<Vec<Tool>>,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let client = build_client(config.proxy.as_ref(), 300, config.tls_backend)?;
    let request = CountTokensRequest {
        model,
        messages: messages.to_vec(),
        system: system.clone(),
        tools: tools.clone(),
    };
    let mut req_builder = client.post(api_url);
    if let Some(api_key) = &config.api_key {
        if config.auth_type == "bearer" {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        } else {
            req_builder = req_builder.header("x-api-key", api_key);
        }
    }
    let response = req_builder
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("API 返回错误状态: {}", response.status()).into());
    }
    let result: CountTokensResponse = response.json().await?;
    Ok(result.input_tokens as u64)
}

fn count_all_tokens_local(
    system: Option<Vec<SystemMessage>>,
    messages: Vec<Message>,
    tools: Option<Vec<Tool>>,
) -> u64 {
    let enc = encoder();
    let mut total: usize = 0;

    if let Some(ref system) = system {
        for msg in system {
            total += enc.count(&msg.text);
        }
    }

    for msg in &messages {
        if let serde_json::Value::String(s) = &msg.content {
            total += enc.count(s);
        } else if let serde_json::Value::Array(arr) = &msg.content {
            for item in arr {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    total += enc.count(text);
                }
            }
        }
    }

    if let Some(ref tools) = tools {
        for tool in tools {
            total += enc.count(&tool.name);
            total += enc.count(&tool.description);
            let input_schema_json = serde_json::to_string(&tool.input_schema).unwrap_or_default();
            total += enc.count(&input_schema_json);
        }
    }

    let corrected = (total as f64 * CLAUDE_CORRECTION_FACTOR).ceil() as u64;
    corrected.max(1)
}

/// 估算输出 tokens（BPE 编码 + Claude 修正）
pub(crate) fn estimate_output_tokens(content: &[serde_json::Value]) -> i32 {
    let enc = encoder();
    let mut total: usize = 0;

    for block in content {
        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
            total += enc.count(text);
        }
        if let Some(thinking) = block.get("thinking").and_then(|v| v.as_str()) {
            total += enc.count(thinking);
        }
        if block.get("type").and_then(|v| v.as_str()) == Some("redacted_thinking") {
            total += 8;
        }
        if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
            if let Some(input) = block.get("input") {
                let input_str = serde_json::to_string(input).unwrap_or_default();
                total += enc.count(&input_str);
            }
        }
    }

    let corrected = (total as f64 * CLAUDE_CORRECTION_FACTOR).ceil() as i32;
    corrected.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn count_tokens_english() {
        let tokens = count_tokens("Hello, world!");
        assert!(tokens >= 3 && tokens <= 6);
    }

    #[test]
    fn count_tokens_chinese() {
        let tokens = count_tokens("你好世界");
        assert!(tokens >= 3 && tokens <= 8);
    }

    #[test]
    fn estimate_output_tokens_counts_thinking() {
        let with_thinking = estimate_output_tokens(&[json!({
            "type": "thinking",
            "thinking": "需要计入输出 token"
        })]);
        let text_only = estimate_output_tokens(&[json!({
            "type": "text",
            "text": ""
        })]);
        assert!(with_thinking > text_only);
    }
}
