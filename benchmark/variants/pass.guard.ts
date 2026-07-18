/**
 * BIẾN THỂ "pass" — guard rỗng, luôn cho qua.
 * Đo chi phí SÀN của cơ chế guard NestJS (DI + reflector + gọi canActivate)
 * mà không có logic RBAC nào. Chênh lệch (generated - pass) = chi phí thuần
 * của thuật toán RBAC.
 *
 * File này được make-variant.js chép đè lên auth/guards/rbac.guard.ts.
 */
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class RbacGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
