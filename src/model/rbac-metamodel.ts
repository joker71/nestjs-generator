export interface RbacRole {
  name: string;
  permissions: string[];
  extendsRole?: string;
  domain?: string;
}

export interface RbacModel {
  roles: RbacRole[];
  allPermissions: string[];
}

