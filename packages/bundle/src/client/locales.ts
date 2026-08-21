/** Web-search Settings copy keys. */
export type WebSearchSettingsKey =
  | 'nav'
  | 'title'
  | 'engine'
  | 'engineTavily'
  | 'engineBrave'
  | 'engineSearxng'
  | 'apiKey'
  | 'apiKeyConfigured'
  | 'apiKeyEmpty'
  | 'baseUrl'
  | 'searxngUrl'
  | 'save'
  | 'discard'
  | 'statusUnavailable'
  | 'statusCurrent'
  | 'statusNone'
  | 'statusKeyReady'
  | 'statusKeyMissing'
  | 'statusUrlReady'
  | 'statusUrlMissing'
  | 'statusProviderReady'
  | 'statusProviderUnavailable'
  | 'statusNext'
  | 'statusFailure'
  | 'dirty'

/** Chinese primary product copy. */
export const zh: Record<WebSearchSettingsKey, string> = {
  nav: '网络搜索',
  title: '网络搜索',
  engine: '搜索引擎',
  engineTavily: 'Tavily',
  engineBrave: 'Brave',
  engineSearxng: 'SearXNG',
  apiKey: 'API 密钥',
  apiKeyConfigured: '已配置',
  apiKeyEmpty: '未配置',
  baseUrl: '接口地址',
  searxngUrl: 'SearXNG 地址',
  save: '保存',
  discard: '放弃',
  statusUnavailable: '尚未选择可用引擎，web_search 会失败',
  statusCurrent: '当前引擎',
  statusNone: '未选择',
  statusKeyReady: 'API 密钥已配置',
  statusKeyMissing: 'API 密钥未配置',
  statusUrlReady: '地址已配置',
  statusUrlMissing: '地址未配置',
  statusProviderReady: '服务已就绪',
  statusProviderUnavailable: '服务不可用',
  statusNext: '下一次 web_search 将通过此包装器使用当前引擎',
  statusFailure: '通过此包装器调用 web_search 将失败',
  dirty: '有未保存的更改',
}

/** English fallback product copy. */
export const en: Record<WebSearchSettingsKey, string> = {
  nav: 'Web search',
  title: 'Web search',
  engine: 'Search engine',
  engineTavily: 'Tavily',
  engineBrave: 'Brave',
  engineSearxng: 'SearXNG',
  apiKey: 'API key',
  apiKeyConfigured: 'Configured',
  apiKeyEmpty: 'Not configured',
  baseUrl: 'API base URL',
  searxngUrl: 'SearXNG URL',
  save: 'Save',
  discard: 'Discard',
  statusUnavailable: 'No usable engine is selected; web_search will fail',
  statusCurrent: 'Current engine',
  statusNone: 'None',
  statusKeyReady: 'API key configured',
  statusKeyMissing: 'API key not configured',
  statusUrlReady: 'URL configured',
  statusUrlMissing: 'URL not configured',
  statusProviderReady: 'Provider ready',
  statusProviderUnavailable: 'Provider unavailable',
  statusNext: 'The next web_search will use the current engine through this wrapper',
  statusFailure: 'web_search through this wrapper will fail',
  dirty: 'Unsaved changes',
}
