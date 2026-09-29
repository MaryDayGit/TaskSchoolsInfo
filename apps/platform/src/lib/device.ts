const OS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];
const BROWSERS: Record<string, string> = {
  Edg: 'Edge',
  Firefox: 'Firefox',
  Chrome: 'Chrome',
  Version: 'Safari',
};

/** Short device description for the teacher: "Windows · Chrome 109", "Android · Chrome 128 · телефон". */
export function describeDevice(ua = navigator.userAgent): string {
  const os = OS.find(([re]) => re.test(ua))?.[1] ?? 'інше';
  const m = ua.match(/(Edg|Firefox|Chrome|Version)\/(\d+)/);
  const browser = m ? `${BROWSERS[m[1]!]} ${m[2]}` : 'браузер';
  const phone = /Mobile|iPhone/.test(ua) ? ' · телефон' : '';
  return `${os} · ${browser}${phone}`.slice(0, 60);
}
