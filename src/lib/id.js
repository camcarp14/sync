// Short, sortable, collision-free enough for a single-user app: a base-36
// timestamp prefix keeps ids in creation order when they're sorted as strings,
// and four random characters make same-millisecond collisions a non-event.
let last = 0;
let seq = 0;

export function id(prefix = "") {
  const now = Date.now();
  if (now === last) seq++; else { last = now; seq = 0; }
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}${now.toString(36)}${seq.toString(36)}${rand}`;
}
