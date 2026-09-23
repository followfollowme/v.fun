/* 宽松解析层：缺字段给默认值，未知字段忽略；snake_case 优先，camelCase 兜底 */

function pick(raw, snake, camel) {
  if (raw[snake] !== undefined && raw[snake] !== null) return raw[snake];
  if (camel && raw[camel] !== undefined && raw[camel] !== null) return raw[camel];
  return undefined;
}

function str(raw, snake, camel, def = '') {
  const v = pick(raw, snake, camel);
  return v === undefined ? def : String(v);
}

function bool(raw, snake, camel, def = false) {
  const v = pick(raw, snake, camel);
  if (v === undefined || v === '') return def;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function normalizeTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(/[,，/]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeEpisodes(list, fallbackLink, fallbackName) {
  if (!Array.isArray(list) || list.length === 0) {
    return [{ name: fallbackName || '正片', link: fallbackLink, is_vip: false }];
  }
  return list.map((ep, i) => ({
    name: str(ep, 'name', null) || `第${i + 1}集`,
    link: str(ep, 'link'),
    is_vip: bool(ep, 'is_vip', 'isVip'),
  }));
}

function normalizeVideo(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const name = str(raw, 'name');
  const link = str(raw, 'link');
  const episodesText = str(raw, 'episodes');
  return {
    name,
    link,
    preview_image: str(raw, 'preview_image', 'previewImage'),
    actors: str(raw, 'actors'),
    episodes: episodesText,
    channel: str(raw, 'channel'),
    is_live: bool(raw, 'is_live', 'isLive'),
    duration: str(raw, 'duration'),
    description: str(raw, 'description'),
    tags: normalizeTags(pick(raw, 'tags')),
    episodes_list: normalizeEpisodes(pick(raw, 'episodes_list'), link, episodesText),
  };
}

function normalizeChannel(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    id: str(raw, 'id'),
    name: str(raw, 'name'),
    enabled: bool(raw, 'enabled', null, true),
    is_live: bool(raw, 'is_live', 'isLive'),
    data_url: str(raw, 'data_url'),
  };
}

function normalizeConfig(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const channels = Array.isArray(raw.channels)
    ? raw.channels.map(normalizeChannel).filter((c) => c.enabled && c.id && c.data_url)
    : [];
  return {
    updated_at: str(raw, 'updated_at'),
    channels,
  };
}

function normalizeChannelData(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    channel_id: str(raw, 'channel_id'),
    updated_at: str(raw, 'updated_at'),
    videos: Array.isArray(raw.videos) ? raw.videos.map(normalizeVideo) : [],
  };
}

/* 稳定标识：与 build.py 中 cyrb53 实现保持一致，供生成/匹配播放页 URL */
function videoHash(video) {
  return cyrb53(video.name + '|' + video.link).toString(16);
}

function cyrb53(input, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097152 & h2) + (h1 >>> 0);
}

window.Parser = {
  normalizeConfig,
  normalizeChannelData,
  normalizeVideo,
  videoHash,
};
