// 静态资源统一使用构建时的站点路径，兼容根域名和 Pages 仓库子目录。
export const SITE_BASE = import.meta.env?.BASE_URL ?? '/';
export const assetUrl = (path: string): string => `${SITE_BASE}${path.replace(/^\/+/, '')}`;
