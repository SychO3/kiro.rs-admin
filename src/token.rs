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

/// 根据模型和 token 用量按官方定价计算费用（USD）
pub fn calculate_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
) -> f64 {
    let model_id = normalize_pricing_model(model);
    let Some(m) = tiktoken::pricing::get_model(&model_id) else {
        return 0.0;
    };
    let pricing = m.pricing_for_input(input_tokens + cache_creation_tokens + cache_read_tokens);
    let input_cost = input_tokens as f64 * pricing.input_per_1m / 1_000_000.0;
    let output_cost = output_tokens as f64 * pricing.output_per_1m / 1_000_000.0;
    let cache_read_cost = match pricing.cached_input_per_1m {
        Some(rate) => cache_read_tokens as f64 * rate / 1_000_000.0,
        None => cache_read_tokens as f64 * pricing.input_per_1m / 1_000_000.0,
    };
    // cache creation = input price × 1.25 (Anthropic convention)
    let cache_creation_cost = cache_creation_tokens as f64 * pricing.input_per_1m * 1.25 / 1_000_000.0;
    input_cost + output_cost + cache_read_cost + cache_creation_cost
}

/// 将项目内部模型名映射到 tiktoken pricing 能识别的 ID
fn normalize_pricing_model(model: &str) -> String {
    let m = model.replace("-thinking", "");
    // tiktoken pricing 使用点号格式如 "claude-opus-4-6"
    // 项目内部可能用横杠如 "claude-opus-4-6"
    // 规则：最后一段横杠分隔的数字部分，把横杠替换为点号
    // claude-opus-4-6 → claude-opus-4-6
    // claude-haiku-4-5 → claude-haiku-4.5
    if let Some(pos) = m.rfind('-') {
        let suffix = &m[pos + 1..];
        if suffix.chars().all(|c| c.is_ascii_digit()) && suffix.len() <= 2 {
            let prefix = &m[..pos];
            if let Some(pos2) = prefix.rfind('-') {
                let mid = &prefix[pos2 + 1..];
                if mid.chars().all(|c| c.is_ascii_digit()) {
                    return format!("{}{}.{}", &prefix[..pos2 + 1], mid, suffix);
                }
            }
        }
    }
    // claude-sonnet-5 等没有次版本号的，或者非 Claude 模型直接透传
    m
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

    #[test]
    fn calculate_cost_opus_46() {
        // claude-opus-4-6: input $5/M, output $25/M, cache_read $0.5/M
        let cost = calculate_cost("claude-opus-4-6", 1_000_000, 0, 0, 0);
        assert!((cost - 5.0).abs() < 0.01, "input cost: {cost}");
        let cost = calculate_cost("claude-opus-4-6", 0, 1_000_000, 0, 0);
        assert!((cost - 25.0).abs() < 0.01, "output cost: {cost}");
        let cost = calculate_cost("claude-opus-4-6", 0, 0, 0, 1_000_000);
        assert!((cost - 0.5).abs() < 0.01, "cache read cost: {cost}");
    }

    #[test]
    fn normalize_model_names() {
        assert_eq!(normalize_pricing_model("claude-opus-4-6"), "claude-opus-4.6");
        assert_eq!(normalize_pricing_model("claude-opus-4.6"), "claude-opus-4.6");
        assert_eq!(normalize_pricing_model("claude-haiku-4-5"), "claude-haiku-4.5");
        assert_eq!(normalize_pricing_model("claude-sonnet-4"), "claude-sonnet-4");
        assert_eq!(normalize_pricing_model("claude-opus-4-6-thinking"), "claude-opus-4.6");
        assert_eq!(normalize_pricing_model("deepseek-3.2"), "deepseek-3.2");
    }
}
