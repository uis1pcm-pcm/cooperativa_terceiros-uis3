export function makeToken(n = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let t = "";
  for (let i = 0; i < n; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}
