//! 模型定价表（可配置 + LiteLLM 自动同步）
//!
//! 定价来源优先级：
//! 1. 运行时覆盖表（config.json 的 `modelPricing`，可由 Admin UI / LiteLLM 同步写入）
//! 2. 内置默认表（编译进二进制，保证离线可用，取自 2026 官方公开价）
//!
//! 单价单位：USD / 1M tokens。
//! - `input` / `output`：标准输入 / 输出
//! - `cache_read`：命中缓存读取（约 input × 0.1）
//! - `cache_creation`：写入缓存（约 input × 1.25）
//! - `input_above_200k` / `output_above_200k`：1M 上下文模型 >200K 输入时的分级价
//!
//! LiteLLM 数据源（机器可读，持续维护）：
//! <https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json>

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// 单个模型的定价（USD / 1M tokens）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    pub input: f64,
    pub output: f64,
    #[serde(default)]
    pub cache_read: f64,
    #[serde(default)]
    pub cache_creation: f64,
    /// 输入 >200K token 时的分级输入价（1M 上下文模型）。None 表示无分级。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_above_200k: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_above_200k: Option<f64>,
}

impl ModelPrice {
    /// 便捷构造：cache_read = input×0.1，cache_creation = input×1.25
    const fn standard(input: f64, output: f64) -> Self {
        Self {
            input,
            output,
            cache_read: input * 0.1,
            cache_creation: input * 1.25,
            input_above_200k: None,
            output_above_200k: None,
        }
    }

    /// 带 200k 分级的构造（1M 上下文模型）
    const fn tiered(input: f64, output: f64, input_200k: f64, output_200k: f64) -> Self {
        Self {
            input,
            output,
            cache_read: input * 0.1,
            cache_creation: input * 1.25,
            input_above_200k: Some(input_200k),
            output_above_200k: Some(output_200k),
        }
    }
}

/// 内置默认定价表（横杠格式 ID）。取自 2026 官方公开价 + LiteLLM。
fn builtin() -> HashMap<String, ModelPrice> {
    let mut m = HashMap::new();
    // Opus 4.x: $5 / $25
    for id in ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5"] {
        m.insert(id.to_string(), ModelPrice::standard(5.0, 25.0));
    }
    // Opus 4 / 4.1（旧）: $15 / $75
    m.insert("claude-opus-4-1".into(), ModelPrice::standard(15.0, 75.0));
    m.insert("claude-opus-4".into(), ModelPrice::standard(15.0, 75.0));
    // Sonnet 5: $2 / $10
    m.insert("claude-sonnet-5".into(), ModelPrice::standard(2.0, 10.0));
    // Sonnet 4.x: $3 / $15（4.5/4 有 200k 分级：>200k 时 $6 / $22.5）
    m.insert("claude-sonnet-4-6".into(), ModelPrice::standard(3.0, 15.0));
    m.insert(
        "claude-sonnet-4-5".into(),
        ModelPrice::tiered(3.0, 15.0, 6.0, 22.5),
    );
    m.insert(
        "claude-sonnet-4".into(),
        ModelPrice::tiered(3.0, 15.0, 6.0, 22.5),
    );
    // Haiku 4.5: $1 / $5
    m.insert("claude-haiku-4-5".into(), ModelPrice::standard(1.0, 5.0));
    // Fable 5: $10 / $50
    m.insert("claude-fable-5".into(), ModelPrice::standard(10.0, 50.0));
    m
}

/// 全局定价表（内置默认 + 运行时覆盖）
pub struct PricingTable {
    prices: RwLock<HashMap<String, ModelPrice>>,
}

impl PricingTable {
    /// 用内置默认表 + config 覆盖表初始化
    pub fn new(overrides: &HashMap<String, ModelPrice>) -> Self {
        let mut prices = builtin();
        for (k, v) in overrides {
            prices.insert(canonical_key(k), *v);
        }
        Self {
            prices: RwLock::new(prices),
        }
    }

    /// 查询模型定价（找不到返回 None）
    pub fn get(&self, model: &str) -> Option<ModelPrice> {
        let key = canonical_key(model);
        self.prices.read().get(&key).copied()
    }

    /// 用一批新价合并进当前表（LiteLLM 同步 / UI 编辑用），返回更新条目数
    pub fn merge(&self, updates: HashMap<String, ModelPrice>) -> usize {
        let mut guard = self.prices.write();
        let mut n = 0;
        for (k, v) in updates {
            let key = canonical_key(&k);
            if guard.get(&key) != Some(&v) {
                guard.insert(key, v);
                n += 1;
            }
        }
        n
    }

    /// 导出当前全表快照（供 Admin UI 展示 / 持久化）
    pub fn snapshot(&self) -> HashMap<String, ModelPrice> {
        self.prices.read().clone()
    }
}

/// 跨模块共享句柄
pub type SharedPricing = Arc<PricingTable>;

/// 归一化模型 ID 为定价表键：去 thinking 后缀、去日期后缀、点号转横杠、小写。
/// claude-opus-4.8 → claude-opus-4-8；claude-haiku-4-5-20251001 → claude-haiku-4-5
pub fn canonical_key(model: &str) -> String {
    let mut s = model.trim().to_ascii_lowercase();
    s = s.replace("-thinking", "");
    s = s.replace('.', "-");
    // 去掉 bedrock 风格的 -v1:0 后缀
    if let Some(pos) = s.find(":0") {
        s.truncate(pos);
    }
    s = s.trim_end_matches("-v1").to_string();
    // 去掉末尾的日期后缀（-8位数字）
    if let Some(pos) = s.rfind('-') {
        let suffix = &s[pos + 1..];
        if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            s = s[..pos].to_string();
        }
    }
    s
}

/// 根据定价 + token 用量计算费用（USD）。找不到定价返回 None。
pub fn calculate_cost(
    table: &PricingTable,
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
) -> Option<f64> {
    let p = table.get(model)?;
    // 长上下文分级：总输入（含缓存）超过 200K 时套用分级价
    let total_input = input_tokens + cache_creation_tokens + cache_read_tokens;
    let (input_rate, output_rate) = if total_input > 200_000 {
        (
            p.input_above_200k.unwrap_or(p.input),
            p.output_above_200k.unwrap_or(p.output),
        )
    } else {
        (p.input, p.output)
    };
    let cache_read_rate = if p.cache_read > 0.0 {
        p.cache_read
    } else {
        input_rate * 0.1
    };
    let cache_creation_rate = if p.cache_creation > 0.0 {
        p.cache_creation
    } else {
        input_rate * 1.25
    };
    let cost = input_tokens as f64 * input_rate / 1e6
        + output_tokens as f64 * output_rate / 1e6
        + cache_read_tokens as f64 * cache_read_rate / 1e6
        + cache_creation_tokens as f64 * cache_creation_rate / 1e6;
    Some(cost)
}

/// LiteLLM 定价 JSON 的原始条目（只取我们关心的字段）
#[derive(Debug, Deserialize)]
struct LiteLlmEntry {
    #[serde(default)]
    litellm_provider: String,
    #[serde(default)]
    input_cost_per_token: f64,
    #[serde(default)]
    output_cost_per_token: f64,
    #[serde(default)]
    cache_read_input_token_cost: f64,
    #[serde(default)]
    cache_creation_input_token_cost: f64,
    #[serde(default)]
    input_cost_per_token_above_200k_tokens: Option<f64>,
    #[serde(default)]
    output_cost_per_token_above_200k_tokens: Option<f64>,
}

const LITELLM_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/// 从 LiteLLM 拉取并解析 Anthropic Claude 模型定价（USD / 1M tokens）。
/// 只保留 `litellm_provider == "anthropic"` 且 key 含 "claude" 的条目。
pub async fn fetch_litellm_pricing(
    proxy: Option<&crate::http_client::ProxyConfig>,
    tls_backend: crate::model::config::TlsBackend,
) -> anyhow::Result<HashMap<String, ModelPrice>> {
    let client = crate::http_client::build_client(proxy, 30, tls_backend)?;
    let resp = client.get(LITELLM_URL).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("LiteLLM 定价拉取失败: HTTP {}", resp.status());
    }
    let raw: HashMap<String, serde_json::Value> = resp.json().await?;
    let mut out = HashMap::new();
    for (name, val) in raw {
        let Ok(entry) = serde_json::from_value::<LiteLlmEntry>(val) else {
            continue;
        };
        if entry.litellm_provider != "anthropic" || !name.to_ascii_lowercase().contains("claude") {
            continue;
        }
        if entry.input_cost_per_token <= 0.0 {
            continue;
        }
        let price = ModelPrice {
            input: entry.input_cost_per_token * 1e6,
            output: entry.output_cost_per_token * 1e6,
            cache_read: entry.cache_read_input_token_cost * 1e6,
            cache_creation: entry.cache_creation_input_token_cost * 1e6,
            input_above_200k: entry.input_cost_per_token_above_200k_tokens.map(|v| v * 1e6),
            output_above_200k: entry.output_cost_per_token_above_200k_tokens.map(|v| v * 1e6),
        };
        out.insert(canonical_key(&name), price);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_key_normalizes() {
        assert_eq!(canonical_key("claude-opus-4.8"), "claude-opus-4-8");
        assert_eq!(canonical_key("claude-opus-4-8-thinking"), "claude-opus-4-8");
        assert_eq!(canonical_key("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
        assert_eq!(canonical_key("CLAUDE-SONNET-5"), "claude-sonnet-5");
        assert_eq!(
            canonical_key("anthropic.claude-opus-4-5-20251101-v1:0"),
            "anthropic-claude-opus-4-5"
        );
    }

    #[test]
    fn builtin_has_new_models() {
        let t = PricingTable::new(&HashMap::new());
        assert!(t.get("claude-sonnet-5").is_some());
        assert!(t.get("claude-fable-5").is_some());
        assert!(t.get("claude-opus-4-8").is_some());
        // 点号格式也能命中
        assert!(t.get("claude-opus-4.8").is_some());
        // thinking 后缀
        assert!(t.get("claude-opus-4-8-thinking").is_some());
    }

    #[test]
    fn cost_matches_official() {
        let t = PricingTable::new(&HashMap::new());
        // opus: $5/$25，1M input + 1M output = $30
        let c = calculate_cost(&t, "claude-opus-4-8", 1_000_000, 1_000_000, 0, 0).unwrap();
        assert!((c - 30.0).abs() < 1e-6, "got {}", c);
        // cache_read = input×0.1 = $0.5/1M
        let c2 = calculate_cost(&t, "claude-opus-4-8", 0, 0, 0, 1_000_000).unwrap();
        assert!((c2 - 0.5).abs() < 1e-6, "got {}", c2);
        // cache_creation = input×1.25 = $6.25/1M
        let c3 = calculate_cost(&t, "claude-opus-4-8", 0, 0, 1_000_000, 0).unwrap();
        assert!((c3 - 6.25).abs() < 1e-6, "got {}", c3);
    }

    #[test]
    fn unknown_model_returns_none() {
        let t = PricingTable::new(&HashMap::new());
        assert!(calculate_cost(&t, "gpt-4o", 100, 100, 0, 0).is_none());
    }

    #[test]
    fn long_context_tier_applies() {
        let t = PricingTable::new(&HashMap::new());
        // sonnet-4-5 >200k 输入用 $6/1M（而非 $3）
        let c = calculate_cost(&t, "claude-sonnet-4-5", 300_000, 0, 0, 0).unwrap();
        assert!((c - 300_000.0 * 6.0 / 1e6).abs() < 1e-6, "got {}", c);
    }

    #[test]
    fn config_override_wins() {
        let mut ov = HashMap::new();
        ov.insert("claude-opus-4-8".to_string(), ModelPrice::standard(99.0, 99.0));
        let t = PricingTable::new(&ov);
        let p = t.get("claude-opus-4-8").unwrap();
        assert_eq!(p.input, 99.0);
    }

    #[test]
    fn merge_updates_and_counts() {
        let t = PricingTable::new(&HashMap::new());
        let mut up = HashMap::new();
        up.insert("claude-new-model".to_string(), ModelPrice::standard(1.0, 2.0));
        up.insert("claude-opus-4-8".to_string(), ModelPrice::standard(5.0, 25.0)); // 与内置相同 → 不计
        let n = t.merge(up);
        assert_eq!(n, 1);
        assert!(t.get("claude-new-model").is_some());
    }
}

