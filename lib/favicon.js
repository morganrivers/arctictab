export const TRANSPARENT_PX =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2014%2014%22%3E%3Crect%20width%3D%2214%22%20height%3D%2214%22%20rx%3D%223%22%20fill%3D%22%23999%22%20opacity%3D%220.25%22%2F%3E%3C%2Fsvg%3E";

export function faviconUrlFor(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome:")) return tab.favIconUrl;
  return TRANSPARENT_PX;
}
