/** 邀请只携带房间和连接参数，不把调试参数传给队友。 */
export function inviteUrl(href: string, room: string, lanHost?: string): string {
  const u = new URL(href);
  const relay = u.searchParams.get('relay');
  const lan = u.searchParams.get('network') === 'lan';
  const transport = u.searchParams.get('transport');
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', room);
  if (lan) u.searchParams.set('network', 'lan');
  if (transport === 'rtc') u.searchParams.set('transport', transport);
  if (lanHost && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) u.hostname = lanHost;
  if (relay) {
    const address = new URL(/^wss?:\/\//.test(relay) ? relay : `${u.protocol === 'https:' ? 'wss' : 'ws'}://${relay}`);
    if (lanHost && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(address.hostname)) address.hostname = lanHost;
    u.searchParams.set('relay', address.href);
  }
  return u.href;
}
