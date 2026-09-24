/* 数据层：同源快照 → 配置远程 URL → jsDelivr 镜像 → localStorage 缓存
   同源路径一律写相对路径，由页面 <base> 决定实际位置 */

const CONFIG_URL =
  'https://raw.githubusercontent.com/followfollowme/drama/main/config/drama_config.json';
const MIRROR_PREFIX = 'https://cdn.jsdelivr.net/gh/followfollowme/drama@main/';

function mirrorUrl(url) {
  const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/followfollowme\/drama\/[^/]+\/(.+)$/);
  return m ? MIRROR_PREFIX + m[1] : null;
}

async function fetchRaw(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem('drm:' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function cacheSet(key, data, updatedAt) {
  try {
    localStorage.setItem(
      'drm:' + key,
      JSON.stringify({ updated_at: updatedAt || '', saved_at: new Date().toISOString(), data })
    );
  } catch (e) {
    /* 配额满等情况：缓存写失败不阻塞页面 */
  }
}

/* 按候选 URL 顺序尝试，成功即缓存；全失败回落 localStorage */
async function loadJSON(key, candidates, updatedAt) {
  for (const url of candidates) {
    try {
      const data = await fetchRaw(url);
      cacheSet(key, data, updatedAt || data.updated_at);
      return { data, stale: false, updated_at: updatedAt || data.updated_at };
    } catch (e) {
      /* 尝试下一个来源 */
    }
  }
  const cached = cacheGet(key);
  if (cached) return { data: cached.data, stale: true, updated_at: cached.updated_at };
  return null;
}

function getConfig() {
  return loadJSON('config', [
    'data/config.json',
    mirrorUrl(CONFIG_URL),
    CONFIG_URL,
  ].filter(Boolean));
}

function getChannel(channel) {
  const candidates = [
    'data/' + channel.id + '.json',
    mirrorUrl(channel.data_url),
    channel.data_url,
  ].filter(Boolean);
  return loadJSON('channel:' + channel.id, candidates);
}

/* 搜索索引为构建期产物，仅同源快照；成功后缓存兜底 */
function getIndex() {
  return loadJSON('index', ['data/index.json']);
}

window.Data = { getConfig, getChannel, getIndex };
