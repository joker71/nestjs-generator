import type {BoundedContext, DomainClass, DomainField, DomainMetamodel, DomainMethod} from "../model/dcsl-metamodel";
import type {RbacRole} from "../model/rbac-metamodel";
import {constantCase} from 'change-case';
// ─── AGL Module Action keywords → moduleAction tag ───────────────────────────

const MODULE_ACTION_KEYWORDS: Record<string, string> = {
    create: 'createObject',
    add: 'createObject',
    register: 'createObject',
    update: 'updateObject',
    modify: 'updateObject',
    change: 'updateObject',
    set: 'setDataFieldValues',
    delete: 'deleteObject',
    remove: 'deleteObject',
    open: 'open',
    reset: 'reset',
    cancel: 'cancel',
};

function inferModuleAction(methodName: string): string | undefined {
    const lower = methodName.toLowerCase();
    for (const [kw, action] of Object.entries(MODULE_ACTION_KEYWORDS)) {
        if (lower.startsWith(kw)) return action;
    }
    return undefined;
}

// ─── Default field factory ────────────────────────────────────────────────────

function makeIdField(): DomainField {
    return {
        name: 'id',
        type: 'string',
        visibility: 'private',
        isOptional: false,
        isCollection: false,
        isId: true,
    };
}

function makeCrudMethods(className: string): DomainMethod[] {
    return [
        {
            name: `create${className}`,
            visibility: 'public',
            returnType: 'void',
            parameters: [],
            isAsync: false,
            moduleAction: 'createObject',
        },
        {
            name: `update${className}`,
            visibility: 'public',
            returnType: 'void',
            parameters: [],
            isAsync: false,
            moduleAction: 'updateObject',
        },
        {
            name: `delete${className}`,
            visibility: 'public',
            returnType: 'void',
            parameters: [],
            isAsync: false,
            moduleAction: 'deleteObject',
        },
    ];
}

function makeRepositoryMethods(className: string): DomainMethod[] {
    return [
        {
            name: 'findById',
            visibility: 'public',
            returnType: `Promise<${className} | null>`,
            parameters: [{name: 'id', type: 'string'}],
            isAsync: true,
        },
        {
            name: 'findAll',
            visibility: 'public',
            returnType: `Promise<${className}[]>`,
            parameters: [],
            isAsync: true,
        },
        {
            name: 'save',
            visibility: 'public',
            returnType: `Promise<${className}>`,
            parameters: [{name: `${className.charAt(0).toLowerCase() + className.slice(1)}`, type: className}],
            isAsync: true,
        },
        {
            name: 'delete',
            visibility: 'public',
            returnType: 'Promise<void>',
            parameters: [{name: 'id', type: 'string'}],
            isAsync: true,
        },
    ];
}

// ─── Transformer class ────────────────────────────────────────────────────────

export class ModelTransformer {
    transform(model: DomainMetamodel): DomainMetamodel {
        model.boundedContexts = model.boundedContexts.map((ctx: any) =>
            this.transformContext(ctx, model)
        );
        model.rbac = this.transformRbac(model.rbac.roles, model.boundedContexts);
        return model;
    }

    // ─── Context ───────────────────────────────────────────────────────────────

    private transformContext(
        ctx: BoundedContext,
        model: DomainMetamodel
    ): BoundedContext {
        const enrichedClasses: DomainClass[] = [];

        for (const cls of ctx.classes) {
            const enriched = this.transformClass(cls, ctx);
            enrichedClasses.push(enriched);

            // Auto-generate IRepository for every AggregateRoot without one
            if (cls.stereotype === 'AggregateRoot') {
                const repoName = `I${cls.name}Repository`;
                const hasRepo = ctx.classes.some((c: {
                    name: string | any[];
                    stereotype: string;
                }) => c.name === repoName || c.stereotype === 'Repository' && c.name.includes(cls.name));
                if (!hasRepo) {
                    enrichedClasses.push(this.generateRepository(cls.name, ctx.name));
                }
            }
        }

        return {...ctx, classes: enrichedClasses};
    }

    // ─── Class ────────────────────────────────────────────────────────────────

    private transformClass(cls: DomainClass, ctx: BoundedContext): DomainClass {
        let fields = [...cls.fields];
        let methods = [...cls.methods];

        // ── Ensure id field exists for Entity / AggregateRoot ──────────────────
        if (
            (cls.stereotype === 'AggregateRoot' || cls.stereotype === 'Entity') &&
            !fields.some(f => f.isId || f.name === 'id')
        ) {
            fields = [makeIdField(), ...fields];
        }

        // ── Ensure createdAt / updatedAt for mutable entities ─────────────────
        if (cls.isMutable && cls.stereotype === 'AggregateRoot') {
            if (!fields.some(f => f.name === 'createdAt')) {
                fields.push({
                    name: 'createdAt',
                    type: 'Date',
                    visibility: 'private',
                    isOptional: false,
                    isCollection: false,
                    isId: false
                });
            }
            if (!fields.some(f => f.name === 'updatedAt')) {
                fields.push({
                    name: 'updatedAt',
                    type: 'Date',
                    visibility: 'private',
                    isOptional: true,
                    isCollection: false,
                    isId: false
                });
            }
        }

        // ── Tag methods with AGL module actions ───────────────────────────────
        methods = methods.map(m => ({
            ...m,
            moduleAction: m.moduleAction ?? inferModuleAction(m.name),
        }));

        // ── Generate default CRUD if AggregateRoot has no domain methods ──────
        if (cls.stereotype === 'AggregateRoot' && methods.filter(m => m.visibility === 'public').length === 0) {
            methods = [...methods, ...makeCrudMethods(cls.name)];
        }

        // ── Repository: ensure standard CRUD methods ──────────────────────────
        if (cls.stereotype === 'Repository' && methods.length === 0) {
            const entityName = cls.name.replace(/^I/, '').replace(/Repository$/, '');
            methods = makeRepositoryMethods(entityName);
        }

        return {...cls, fields, methods};
    }

    // ─── Auto-generated Repository ────────────────────────────────────────────

    private generateRepository(aggregateName: string, contextName: string): DomainClass {
        return {
            name: `I${aggregateName}Repository`,
            stereotype: 'Repository',
            boundedContext: contextName,
            isAbstract: true,
            isMutable: false,
            permissions: [],
            fields: [],
            methods: makeRepositoryMethods(aggregateName),
        };
    }

    // ─── RBAC (Sandhu96 RBAC₁ — role hierarchy permission propagation) ────────

    private transformRbac(
        roles: RbacRole[],
        boundedContexts: BoundedContext[]
    ): { roles: RbacRole[]; allPermissions: string[] } {
        // Build role map
        const roleMap = new Map<string, RbacRole>();
        roles.forEach(r => roleMap.set(r.name, {...r, permissions: [...r.permissions]}));

        // Propagate permissions through hierarchy (topological order via repeated passes)
        let changed = true;
        let passes = 0;
        while (changed && passes < 10) {
            changed = false;
            passes++;
            roleMap.forEach(role => {
                if (role.extendsRole) {
                    const parent = roleMap.get(role.extendsRole);
                    if (parent) {
                        const before = role.permissions.length;
                        const merged = [...new Set([...role.permissions, ...parent.permissions])];
                        role.permissions = merged;
                        if (role.permissions.length !== before) changed = true;
                    }
                }
            });
        }

        const enrichedRoles = [...roleMap.values()];
        const roleDerivedPermissions = enrichedRoles.flatMap(r => r.permissions);

        // The generated controller (controller.hbs) always guards its CRUD endpoints with
        // VIEW_{X}S / CREATE_{X} / UPDATE_{X} / DELETE_{X} permission checks, regardless of
        // whether the modeler declared those exact literals inside a <<Role>> block. If they
        // were missing, permissions.enum.ts wouldn't contain them and the generated code
        // would fail to compile. Make sure every AggregateRoot's standard CRUD permissions
        // always exist in the enum; roles still only receive whatever was explicitly modeled.
        const crudPermissions = boundedContexts
            .flatMap(ctx => ctx.classes)
            .filter(c => c.stereotype === 'AggregateRoot')
            .flatMap(c => this.standardCrudPermissions(c.name));

        const allPermissions = [...new Set([...roleDerivedPermissions, ...crudPermissions])].sort();

        return {roles: enrichedRoles, allPermissions};
    }

    private standardCrudPermissions(className: string): string[] {
        const upper = constantCase(className);
        return [`VIEW_${upper}S`, `CREATE_${upper}`, `UPDATE_${upper}`, `DELETE_${upper}`];
    }
}
