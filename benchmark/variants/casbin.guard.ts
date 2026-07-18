/**
 * BIẾN THỂ "casbin" — baseline công nghiệp: node-casbin với RBAC model
 * (role_definition g = hierarchy). Policy được dựng runtime từ chính
 * ROLE_PERMISSION_MAP + ROLE_HIERARCHY của app sinh ra, nên NGỮ NGHĨA
 * giống hệt — chỉ khác cơ chế thực thi (casbin resolve hierarchy lúc
 * enforce, qua matcher g).
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
import { Enforcer, newEnforcer, newModelFromString, StringAdapter } from 'casbin';
import { Role, ROLE_HIERARCHY } from '../rbac/roles.enum';
import { Permission } from '../rbac/permissions.enum';
import { ROLE_PERMISSION_MAP } from '../rbac/role-permission.map';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

const MODEL = `
[request_definition]
r = sub, obj

[policy_definition]
p = sub, obj

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj
`;

function buildPolicyCsv(): string {
  const lines: string[] = [];
  for (const [role, perms] of Object.entries(ROLE_PERMISSION_MAP)) {
    for (const p of perms as Permission[]) lines.push(`p, ${role}, ${p}`);
  }
  // g, child, parent — child kế thừa permission của parent
  for (const [child, parent] of Object.entries(ROLE_HIERARCHY)) {
    if (parent) lines.push(`g, ${child}, ${parent}`);
  }
  return lines.join('\n');
}

let enforcerPromise: Promise<Enforcer> | null = null;
function getEnforcer(): Promise<Enforcer> {
  if (!enforcerPromise) {
    enforcerPromise = newEnforcer(
      newModelFromString(MODEL),
      new StringAdapter(buildPolicyCsv()),
    );
  }
  return enforcerPromise;
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    const e = await getEnforcer();

    if (requiredRoles?.length) {
      let ok = false;
      for (const ur of userRoles) {
        for (const rr of requiredRoles) {
          // eslint-disable-next-line no-await-in-loop
          if (ur === rr || (await e.hasRoleForUser(ur, rr))) { ok = true; break; }
        }
        if (ok) break;
      }
      if (!ok) throw new ForbiddenException('Insufficient role');
    }

    if (requiredPermissions?.length) {
      for (const p of requiredPermissions) {
        let allowed = false;
        for (const ur of userRoles) {
          // eslint-disable-next-line no-await-in-loop
          if (await e.enforce(ur, p)) { allowed = true; break; }
        }
        if (!allowed) throw new ForbiddenException('Insufficient permissions');
      }
    }
    return true;
  }
}
