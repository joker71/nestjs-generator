import * as fs from 'fs-extra';
import * as path from 'path';
import Handlebars from 'handlebars';
import {camelCase, kebabCase, constantCase, pascalCase} from 'change-case';

import {registerHelpers} from './helpers';
import {BoundedContext, DomainClass, DomainMetamodel} from "../model/dcsl-metamodel";
import {RbacRole} from "../model/rbac-metamodel";


// Register all Handlebars helpers once
registerHelpers();

// ─── Template loader ─────────────────────────────────────────────────────────
const TEMPLATES_DIR = path.join(__dirname, 'templates');

function loadTemplate(name: string): Handlebars.TemplateDelegate {
    const filePath = path.join(TEMPLATES_DIR, `${name}.hbs`);
    if (!fs.existsSync(filePath)) throw new Error(`Template not found: ${filePath}`);
    const src = fs.readFileSync(filePath, 'utf-8');
    return Handlebars.compile(src, {noEscape: true});
}

// Lazily loaded templates
const templates: Record<string, Handlebars.TemplateDelegate> = {};

function tpl(name: string): Handlebars.TemplateDelegate {
    if (!templates[name]) templates[name] = loadTemplate(name);
    return templates[name];
}


function writeFile(filePath: string, content: string): void {
    fs.ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');
}

// ─── AGL activity input → generation-time trace comment ──────────────────────
// Surfaces whatever the activity-diagram parser attached to `cls.activityNodes`
// so the behavioral (AGL) input isn't parsed and then dropped — it shows up as a
// traceable comment on the generated use-case, next to the DCSL structural fields.
function aglTrace(cls: DomainClass): string[] {
    return (cls.activityNodes ?? []).map(node => {
        const seq = node.moduleActions.length
            ? node.moduleActions.map(a => a.actName).join(' → ')
            : node.label;
        const posts = node.moduleActions.flatMap(a => a.postStates);
        return posts.length ? `${seq}  ⇒ ${[...new Set(posts)].join(', ')}` : seq;
    });
}


function classCtx(cls: DomainClass, ctx: BoundedContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        className: cls.name,
        classNameCamel: camelCase(cls.name),
        classNameKebab: kebabCase(cls.name),
        classNameUpper: constantCase(cls.name),
        contextName: ctx.name,
        contextNameCamel: camelCase(ctx.name),
        contextNameKebab: kebabCase(ctx.name),
        stereotype: cls.stereotype,
        isMutable: cls.isMutable,
        isAbstract: cls.isAbstract,
        fields: cls.fields,
        methods: cls.methods,
        associations: ctx.associations.filter(
            a => a.sourceClass === cls.name || a.targetClass === cls.name
        ),
        ...extra,
    };
}


export class CodeGenerator {
    constructor(private readonly outDir: string) {
    }

    generate(model: DomainMetamodel): void {
        console.log('model DomainMetamodel', model)
        model.boundedContexts.forEach(ctx => this.generateContext(ctx));
        this.generateRbac(model.rbac.roles, model.rbac.allPermissions);
    }

    // ─── Bounded Context ───────────────────────────────────────────────────────

    private generateContext(ctx: BoundedContext): void {
        // Packages that resolved to zero domain classes (e.g. an RBAC/AccessControl
        // package containing only <<Role>> definitions) carry nothing to scaffold —
        // skip them instead of emitting an empty NestJS module.
        if (ctx.classes.length === 0) return;

        const ctxDir = path.join(this.outDir, kebabCase(ctx.name));

        for (const cls of ctx.classes) {
            switch (cls.stereotype) {
                case 'AggregateRoot':
                    this.generateAggregate(cls, ctx, ctxDir);
                    break;
                case 'Entity':
                    this.generateEntity(cls, ctx, ctxDir);
                    break;
                case 'ValueObject':
                    this.generateValueObject(cls, ctx, ctxDir);
                    break;
                case 'DomainEvent':
                    this.generateDomainEvent(cls, ctx, ctxDir);
                    break;
                case 'DomainService':
                    this.generateDomainService(cls, ctx, ctxDir);
                    break;
                case 'Repository':
                    this.generateRepositoryInterface(cls, ctx, ctxDir);
                    break;
                case 'UseCase':
                    this.generateUseCase(cls, ctx, ctxDir);
                    break;
            }
        }

        // Generate NestJS module
        this.generateModule(ctx, ctxDir);
    }

    // ─── AggregateRoot ─────────────────────────────────────────────────────────

    private generateAggregate(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        const context = classCtx(cls, ctx);

        // Domain entity file
        writeFile(
            path.join(ctxDir, 'domain', 'entities', `${kebabCase(cls.name)}.entity.ts`),
            tpl('entity')(context)
        );

        // Auto-generate repository interface if not explicitly defined
        const repoCtx = {
            ...context,
            aggregateClass: cls.name,
            aggregateClassKebab: kebabCase(cls.name),
            methods: cls.methods
                .filter(m => ['findById', 'findAll', 'save', 'delete'].some(n => m.name.startsWith(n)))
                .concat(
                    // If no repo methods, add defaults
                    cls.methods.filter(m => ['findById', 'findAll', 'save', 'delete'].some(n => m.name.startsWith(n))).length === 0
                        ? [
                            {
                                name: 'findById',
                                visibility: 'public' as const,
                                returnType: `Promise<${cls.name} | null>`,
                                parameters: [{name: 'id', type: 'string'}],
                                isAsync: true
                            },
                            {
                                name: 'findAll',
                                visibility: 'public' as const,
                                returnType: `Promise<${cls.name}[]>`,
                                parameters: [],
                                isAsync: true
                            },
                            {
                                name: 'save',
                                visibility: 'public' as const,
                                returnType: `Promise<${cls.name}>`,
                                parameters: [{name: camelCase(cls.name), type: cls.name}],
                                isAsync: true
                            },
                            {
                                name: 'delete',
                                visibility: 'public' as const,
                                returnType: 'Promise<void>',
                                parameters: [{name: 'id', type: 'string'}],
                                isAsync: true
                            },
                        ]
                        : []
                ),
        };

        writeFile(
            path.join(ctxDir, 'domain', 'repositories', `i-${kebabCase(cls.name)}.repository.ts`),
            tpl('repository-interface')(repoCtx)
        );

        writeFile(
            path.join(ctxDir, 'infrastructure', 'repositories', `${kebabCase(cls.name)}.repository.ts`),
            tpl('repository-impl')(repoCtx)
        );

        writeFile(
            path.join(ctxDir, 'presentation', 'controllers', `${kebabCase(cls.name)}.controller.ts`),
            tpl('controller')(context)
        );

        // Generate Create use-case for each aggregate root
        this.generateDefaultUseCase(cls, ctx, ctxDir);
    }

    private generateEntity(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        writeFile(
            path.join(ctxDir, 'domain', 'entities', `${kebabCase(cls.name)}.entity.ts`),
            tpl('entity')(classCtx(cls, ctx))
        );
    }

    private generateValueObject(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        writeFile(
            path.join(ctxDir, 'domain', 'value-objects', `${kebabCase(cls.name)}.vo.ts`),
            tpl('value-object')(classCtx(cls, ctx))
        );
    }

    private generateDomainEvent(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        writeFile(
            path.join(ctxDir, 'domain', 'events', `${kebabCase(cls.name)}.event.ts`),
            tpl('domain-event')(classCtx(cls, ctx))
        );
    }

    private generateDomainService(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        writeFile(
            path.join(ctxDir, 'domain', 'services', `${kebabCase(cls.name)}.domain-service.ts`),
            tpl('domain-service')(classCtx(cls, ctx))
        );
    }

    private generateRepositoryInterface(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        const entityName = cls.name.replace(/^I/, '').replace(/Repository$/, '');
        const context = {
            ...classCtx(cls, ctx),
            aggregateClass: entityName,
            aggregateClassKebab: kebabCase(entityName),
        };
        writeFile(
            path.join(ctxDir, 'domain', 'repositories', `i-${kebabCase(entityName)}.repository.ts`),
            tpl('repository-interface')(context)
        );
        writeFile(
            path.join(ctxDir, 'infrastructure', 'repositories', `${kebabCase(entityName)}.repository.ts`),
            tpl('repository-impl')(context)
        );
    }

    private generateUseCase(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        const useCaseName = cls.name.replace(/UseCase$/, '');
        const aggregateClass = ctx.classes.find(c => c.stereotype === 'AggregateRoot')?.name ?? 'Entity';
        const context = {
            ...classCtx(cls, ctx),
            useCaseName,
            aggregateClass,
            aggregateClassKebab: kebabCase(aggregateClass),
            aggregateClassCamel: camelCase(aggregateClass),
            commandFields: cls.fields.filter(f => !f.isId),
            aglTrace: aglTrace(cls),
        };
        writeFile(
            path.join(ctxDir, 'application', 'use-cases', kebabCase(useCaseName), `${kebabCase(useCaseName)}.use-case.ts`),
            tpl('use-case')(context)
        );
    }

    private generateDefaultUseCase(cls: DomainClass, ctx: BoundedContext, ctxDir: string): void {
        const useCaseName = `Create${cls.name}`;
        const context = {
            ...classCtx(cls, ctx),
            useCaseName,
            aggregateClass: cls.name,
            aggregateClassKebab: kebabCase(cls.name),
            aggregateClassCamel: camelCase(cls.name),
            commandFields: cls.fields.filter(f => !f.isId && !['createdAt', 'updatedAt'].includes(f.name)),
            aglTrace: aglTrace(cls),
        };
        writeFile(
            path.join(ctxDir, 'application', 'use-cases', kebabCase(useCaseName), `${kebabCase(useCaseName)}.use-case.ts`),
            tpl('use-case')(context)
        );
    }

    // ─── NestJS Module ─────────────────────────────────────────────────────────

    private generateModule(ctx: BoundedContext, ctxDir: string): void {
        const aggregateClasses = ctx.classes
            .filter(c => c.stereotype === 'AggregateRoot')
            .map(c => ({
                name: c.name,
                nameKebab: kebabCase(c.name),
                NAME: constantCase(c.name),
            }));

        const domainServices = ctx.classes
            .filter(c => c.stereotype === 'DomainService')
            .map(c => ({name: c.name, nameKebab: kebabCase(c.name)}));

        const useCases = ctx.classes
            .filter(c => c.stereotype === 'UseCase')
            .map(c => ({name: c.name.replace(/UseCase$/, ''), nameKebab: kebabCase(c.name.replace(/UseCase$/, ''))}));

        // Auto-include Create{Aggregate} use-cases
        aggregateClasses.forEach(a => {
            const autoName = `Create${a.name}`;
            if (!useCases.some(u => u.name === autoName)) {
                useCases.push({name: autoName, nameKebab: kebabCase(autoName)});
            }
        });

        const context = {
            contextName: pascalCase(ctx.name),
            contextNameKebab: kebabCase(ctx.name),
            aggregateClasses,
            domainServices,
            useCases,
        };

        writeFile(
            path.join(ctxDir, `${kebabCase(ctx.name)}.module.ts`),
            tpl('nestjs-module')(context)
        );
    }

    // ─── RBAC ──────────────────────────────────────────────────────────────────

    private generateRbac(roles: RbacRole[], allPermissions: string[]): void {
        const rbacDir = path.join(this.outDir, 'auth', 'rbac');
        const guardsDir = path.join(this.outDir, 'auth', 'guards');
        const decoratorsDir = path.join(this.outDir, 'auth', 'decorators');

        writeFile(
            path.join(rbacDir, 'roles.enum.ts'),
            tpl('roles.enum')({roles})
        );

        writeFile(
            path.join(rbacDir, 'permissions.enum.ts'),
            tpl('permissions.enum')({permissions: allPermissions})
        );

        writeFile(
            path.join(rbacDir, 'role-permission.map.ts'),
            tpl('role-permission-map')({roles})
        );

        writeFile(
            path.join(guardsDir, 'rbac.guard.ts'),
            tpl('rbac-guard')({})
        );

        writeFile(
            path.join(decoratorsDir, 'permissions.decorator.ts'),
            tpl('decorators')({})
        );

        writeFile(
            path.join(decoratorsDir, 'roles.decorator.ts'),
            tpl('roles.decorator')({})
        );
    }
}
