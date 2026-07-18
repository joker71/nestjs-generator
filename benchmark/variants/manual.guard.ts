/**
 * BIẾN THỂ "manual" — guard "viết tay" điển hình: dev cẩn thận sẽ làm phẳng
 * (flatten) role hierarchy MỘT LẦN lúc khởi động, runtime chỉ còn Set lookup.
 *
 * So sánh với guard sinh tự động (expand hierarchy mỗi request): nếu manual
 * nhanh hơn đáng kể khi hierarchy sâu, đó là bằng chứng nên chuyển bước
 * flatten về generation-time trong generator (transformer đã có sẵn
 * fixed-point propagation — chỉ cần sinh map đã phẳng).
 *
 * File này được make-variant.js chép đè lên auth/guards/rbac.guard.ts.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLE_HIERARCHY } from '../rbac/roles.enum';
import { Permission } from '../rbac/permissions.enum';
import { ROLE_PERMISSION_MAP } from '../rbac/role-permission.map';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

// ─── Tính một lần lúc load module ────────────────────────────────────────────
const FLAT_PERMISSIONS: Map<Role, Set<Permission>> = (() => {
  const flat = new Map<Role, Set<Permission>>();
  for (const role of Object.values(Role) as Role[]) {
    const perms = new Set<Permission>();
    let current: Role | undefined = role;
    const seen = new Set<Role>();
    while (current && !seen.has(current)) {
      seen.add(current);
      for (const p of ROLE_PERMISSION_MAP[current] ?? []) perms.add(p);
      current = ROLE_HIERARCHY[current];
    }
    flat.set(role, perms);
  }
  return flat;
})();

const FLAT_ROLES: Map<Role, Set<Role>> = (() => {
  const flat = new Map<Role, Set<Role>>();
  for (const role of Object.values(Role) as Role[]) {
    const reach = new Set<Role>();
    let current: Role | undefined = role;
    while (current && !reach.has(current)) {
      reach.add(current);
      current = ROLE_HIERARCHY[current];
    }
    flat.set(role, reach);
  }
  return flat;
})();

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions?.length && !requiredRoles?.length) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user?.roles?.length) throw new ForbiddenException('No roles assigned');
    const userRoles = user.roles as Role[];

    if (requiredRoles?.length) {
      const ok = requiredRoles.some((r) =>
        userRoles.some((ur) => FLAT_ROLES.get(ur)?.has(r)),
      );
      if (!ok) throw new ForbiddenException('Insufficient role');
    }

    if (requiredPermissions?.length) {
      const ok = requiredPermissions.every((p) =>
        userRoles.some((ur) => FLAT_PERMISSIONS.get(ur)?.has(p)),
      );
      if (!ok) throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
