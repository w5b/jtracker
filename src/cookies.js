import { Cookie, CookieJar } from 'tough-cookie';
import { asHTTP, site } from './profile.js';

export class BrowserCookies {
  constructor() { this.jar = new CookieJar(undefined, { prefixSecurity: 'strict', allowSecureOnLocal: true }); }
  set(setCookie, input) {
    const url = asHTTP(input);
    const cookie = Cookie.parse(setCookie);
    if (!cookie) return false;
    // No CHIPS storage: dropping these is safer than turning a partitioned cookie
    // into an unpartitioned one. SameSite=None requires Secure in Chromium.
    if (cookie.extensions?.some(e => /^partitioned(?:=|$)/i.test(e))) return false;
    if (cookie.sameSite === 'none' && !cookie.secure) return false;
    if (!cookie.sameSite) cookie.sameSite = 'lax';
    try { return !!this.jar.setCookieSync(cookie, url.href, { ignoreError: true }); }
    catch { return false; }
  }
  get(input, { initiator, navigation = false, method = 'GET', crossSiteRedirect = false } = {}) {
    const url = asHTTP(input);
    const sameSite = !crossSiteRedirect && (!initiator || site(url) === site(initiator));
    const context = sameSite ? 'strict' : navigation && ['GET', 'HEAD'].includes(method) ? 'lax' : 'none';
    return this.jar.getCookieStringSync(url.href, { sameSiteContext: context });
  }
}
