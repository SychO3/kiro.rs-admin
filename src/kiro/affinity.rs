//! 凭据会话亲和性
//!
//! 用 client key id 作为 routing key 绑定凭据，让同一客户端的请求
//! 优先路由到同一个上游凭据，保证 prompt cache 命中。

use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const DEFAULT_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_ENTRIES: usize = 4096;

struct Entry {
    credential_id: u64,
    last_used: Instant,
}

pub struct CredentialAffinity {
    inner: Mutex<HashMap<u64, Entry>>,
    ttl: Duration,
}

impl Default for CredentialAffinity {
    fn default() -> Self {
        Self::new(DEFAULT_TTL)
    }
}

impl CredentialAffinity {
    pub fn new(ttl: Duration) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            ttl,
        }
    }

    pub fn get(&self, key_id: u64) -> Option<u64> {
        let mut map = self.inner.lock();
        if let Some(entry) = map.get(&key_id) {
            if entry.last_used.elapsed() < self.ttl {
                return Some(entry.credential_id);
            }
            map.remove(&key_id);
        }
        None
    }

    pub fn set(&self, key_id: u64, credential_id: u64) {
        let mut map = self.inner.lock();
        if map.len() >= MAX_ENTRIES && !map.contains_key(&key_id) {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, e)| e.last_used)
                .map(|(k, _)| *k)
            {
                map.remove(&oldest);
            }
        }
        map.insert(
            key_id,
            Entry {
                credential_id,
                last_used: Instant::now(),
            },
        );
    }

    pub fn touch(&self, key_id: u64) {
        if let Some(entry) = self.inner.lock().get_mut(&key_id) {
            entry.last_used = Instant::now();
        }
    }

    pub fn remove_by_credential(&self, credential_id: u64) {
        self.inner
            .lock()
            .retain(|_, e| e.credential_id != credential_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_get_set() {
        let aff = CredentialAffinity::default();
        assert_eq!(aff.get(1), None);
        aff.set(1, 42);
        assert_eq!(aff.get(1), Some(42));
    }

    #[test]
    fn ttl_expires() {
        let aff = CredentialAffinity::new(Duration::from_millis(10));
        aff.set(1, 42);
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(aff.get(1), None);
    }

    #[test]
    fn remove_by_credential_works() {
        let aff = CredentialAffinity::default();
        aff.set(1, 10);
        aff.set(2, 10);
        aff.set(3, 20);
        aff.remove_by_credential(10);
        assert_eq!(aff.get(1), None);
        assert_eq!(aff.get(2), None);
        assert_eq!(aff.get(3), Some(20));
    }
}
