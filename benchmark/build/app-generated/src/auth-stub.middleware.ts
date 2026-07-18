/** Auth stub cho benchmark: x-roles: "Admin,StudentRole" → req.user.roles */
export function rolesHeaderMiddleware(req: any, _res: any, next: () => void) {
  const h = req.headers['x-roles'];
  if (typeof h === 'string' && h.length > 0) {
    req.user = { roles: h.split(',').map((s: string) => s.trim()) };
  }
  next();
}
