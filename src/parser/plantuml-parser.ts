import type {
    AssociationType, BoundedContext,
    DddStereotype, DomainAssociation, DomainClass,
    DomainField, DomainMetamodel,
    DomainMethod,
    Multiplicity,
    Visibility
} from "../model/dcsl-metamodel";
import type {RbacRole} from "../model/rbac-metamodel";
import {ActivityDiagramParser} from "./activity-parser";


import {readFileSync, existsSync} from 'node:fs';


// ─── Helpers ─────────────────────────────────────────────────────────────────

const STEREOTYPE_MAP: Record<string, DddStereotype> = {
    aggregateroot: 'AggregateRoot',
    'aggregate-root': 'AggregateRoot',
    aggregate: 'AggregateRoot',
    entity: 'Entity',
    valueobject: 'ValueObject',
    'value-object': 'ValueObject',
    vo: 'ValueObject',
    domainservice: 'DomainService',
    'domain-service': 'DomainService',
    service: 'DomainService',
    domainevent: 'DomainEvent',
    'domain-event': 'DomainEvent',
    event: 'DomainEvent',
    repository: 'Repository',
    repo: 'Repository',
    usecase: 'UseCase',
    'use-case': 'UseCase',
    role: 'Role',
};

function parseStereotype(raw: string): DddStereotype | null {
    const key = raw.toLowerCase().replace(/\s+/g, '');
    return STEREOTYPE_MAP[key] ?? null;
}

function parseVisibility(prefix: string): Visibility {
    if (prefix === '+') return 'public';
    if (prefix === '-') return 'private';
    if (prefix === '#') return 'protected';
    return 'public';
}

function normalizeMultiplicity(m: string): Multiplicity {
    const t = m.trim().replace(/"/g, '');
    if (t === '0..1') return '0..1';
    if (t === '1') return '1';
    if (t === '0..*' || t === '*') return '0..*';
    if (t === '1..*') return '1..*';
    return '1';
}

function parseAssociationType(sym: string): AssociationType {
    if (sym.includes('*--') || sym.includes('--*')) return 'composition';
    if (sym.includes('o--') || sym.includes('--o')) return 'aggregation';
    if (sym.includes('..>') || sym.includes('<..')) return 'dependency';
    if (sym.includes('..|>') || sym.includes('<|..')) return 'realization';
    return 'association';
}

// ─── Field parser ─────────────────────────────────────────────────────────────

function parseField(line: string): DomainField | null {
    // [+|-|#] name: Type [= default]
    // collection: name: Type[] or Collection<Type>
    const m = line.match(/^([+\-#~]?)\s*(\w+)\s*:\s*([^\s=]+)(?:\s*=\s*(.+))?$/);
    if (!m) return null;
    const [, vis, name, rawType, defaultValue] = m;
    const isCollection = rawType.endsWith('[]') || rawType.toLowerCase().startsWith('collection<') || rawType.toLowerCase().startsWith('list<') || rawType.toLowerCase().startsWith('set<');
    const baseType = isCollection
        ? rawType.replace(/\[\]$/, '').replace(/^(?:Collection|List|Set)<(.+)>$/i, '$1')
        : rawType;
    return {
        name,
        type: baseType,
        visibility: parseVisibility(vis),
        isOptional: name.endsWith('?') || false,
        isCollection,
        isId: name.toLowerCase() === 'id',
        defaultValue: defaultValue?.trim(),
    };
}

// ─── Method parser ────────────────────────────────────────────────────────────

function parseMethod(line: string): DomainMethod | null {
    // [+|-|#] name(params): ReturnType
    const m = line.match(/^([+\-#~]?)\s*(\w+)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
    if (!m) return null;
    const [, vis, name, rawParams, returnType] = m;
    const parameters = rawParams
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => {
            const parts = p.split(':').map(x => x.trim());
            return {name: parts[0] ?? p, type: parts[1] ?? 'any'};
        });
    const retType = returnType?.trim() ?? 'void';
    const isAsync = retType.startsWith('Promise<') || retType.toLowerCase() === 'promise';
    return {
        name,
        visibility: parseVisibility(vis),
        returnType: retType,
        parameters,
        isAsync,
    };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export class PlantUmlParser {
    private lines: string[] = [];
    private pos = 0;

    parse(filePath: string, activityFilePath?: string): DomainMetamodel {
        const src = readFileSync(filePath, 'utf-8');
        const appName = this.extractAppName(filePath);
        this.lines = src
            .split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l && !l.startsWith("'") && !l.startsWith("/'") && l !== '@startuml' && l !== '@enduml');
        this.pos = 0;

        const boundedContexts: BoundedContext[] = [];
        const rbacRoles: RbacRole[] = [];
        const roleHierarchy: Array<{ child: string; parent: string }> = [];
        // orphan classes (no package wrapper)
        const orphanClasses: DomainClass[] = [];
        const orphanAssociations: DomainAssociation[] = [];

        while (this.pos < this.lines.length) {
            const line = this.lines[this.pos];

            // ── package / bounded context ────────────────────────────────────────
            const pkgMatch = line.match(/^package\s+"?([^"<]+)"?\s*(?:<<(\w+)>>)?\s*\{?/);
            if (pkgMatch) {
                const ctxName = pkgMatch[1].trim();
                const ctxStereotype = pkgMatch[2]?.toLowerCase();
                this.pos++;
                const {classes, associations} = this.parsePackageBody(ctxName, ctxStereotype);

                // Separate RBAC roles from domain classes
                const domainClasses = classes.filter(c => c.stereotype !== 'Role');
                const roleClasses = classes.filter(c => c.stereotype === 'Role');
                const roleNames = new Set(roleClasses.map(c => c.name));
                roleClasses.forEach(rc => {
                    rbacRoles.push({name: rc.name, permissions: rc.permissions});
                });
                associations
                    .filter(a => a.type === 'association' && roleNames.has(a.sourceClass) && roleNames.has(a.targetClass))
                    .forEach(a => roleHierarchy.push({child: a.sourceClass, parent: a.targetClass}));

                // Packages that only declare <<Role>> classes (e.g. an RBAC/AccessControl
                // package) carry no domain classes of their own once roles are extracted —
                // don't register them as a bounded context / NestJS module.
                if (domainClasses.length > 0) {
                    const domainClassNames = new Set(domainClasses.map(c => c.name));
                    boundedContexts.push({
                        name: ctxName,
                        classes: domainClasses,
                        associations: associations.filter(
                            a => domainClassNames.has(a.sourceClass) || domainClassNames.has(a.targetClass)
                        ),
                    });
                }
                continue;
            }

            // ── standalone class / interface (no package) ────────────────────────
            const classInfo = this.tryParseClassHeader(line, 'DefaultContext');
            if (classInfo) {
                this.pos++;
                const {cls, needsBody} = classInfo;
                if (needsBody) {
                    const {fields, methods, permissions} = this.parseClassBody(cls.stereotype);
                    cls.fields = fields;
                    cls.methods = methods;
                    cls.permissions = permissions;
                }
                if (cls.stereotype === 'Role') {
                    rbacRoles.push({name: cls.name, permissions: cls.permissions});
                } else {
                    orphanClasses.push(cls);
                }
                continue;
            }

            // ── association line ─────────────────────────────────────────────────
            const assoc = this.tryParseAssociation(line);
            if (assoc) {
                // Role hierarchy (--|>)
                if (line.includes('--|>')) {
                    roleHierarchy.push({child: assoc.sourceClass, parent: assoc.targetClass});
                } else {
                    orphanAssociations.push(assoc);
                }
                this.pos++;
                continue;
            }

            // ── skip } and other tokens ──────────────────────────────────────────
            this.pos++;
        }

        // Apply role hierarchy (RBAC₁)
        roleHierarchy.forEach(({child, parent}) => {
            const role = rbacRoles.find(r => r.name === child);
            if (role) role.extendsRole = parent;
        });

        // If no bounded contexts were declared, wrap orphans in DefaultContext
        if (boundedContexts.length === 0 && orphanClasses.length > 0) {
            boundedContexts.push({
                name: 'DefaultContext',
                classes: orphanClasses,
                associations: orphanAssociations,
            });
        } else if (orphanClasses.length > 0) {
            // Attach orphan classes to first bounded context
            boundedContexts[0].classes.push(...orphanClasses);
            boundedContexts[0].associations.push(...orphanAssociations);
        }

        // Deduplicate and collect all permissions
        const allPermissions = [...new Set(rbacRoles.flatMap(r => r.permissions))];

        // ── AGL behavioral input: companion activity diagram ──────────────────
        // Explicit path wins; otherwise auto-detect `<name>.activity.puml` next to
        // the class diagram (mirrors the `.ocl` companion-file convention).
        const resolvedActivityPath = activityFilePath ?? filePath.replace(/\.puml?$/i, '.activity.puml');
        if (existsSync(resolvedActivityPath)) {
            const activityNodes = new ActivityDiagramParser().parse(resolvedActivityPath);
            for (const ctx of boundedContexts) {
                for (const cls of ctx.classes) {
                    const matching = activityNodes.filter(n => n.refClass === cls.name);
                    if (matching.length) cls.activityNodes = matching;
                }
            }
        }

        return {
            appName,
            boundedContexts,
            rbac: {roles: rbacRoles, allPermissions},
        };
    }

    // ─── Package body ──────────────────────────────────────────────────────────

    private parsePackageBody(
        contextName: string,
        _ctxStereotype?: string
    ): { classes: DomainClass[]; associations: DomainAssociation[] } {
        const classes: DomainClass[] = [];
        const associations: DomainAssociation[] = [];
        let depth = 1;

        while (this.pos < this.lines.length) {
            const line = this.lines[this.pos];

            if (line === '{') {
                depth++;
                this.pos++;
                continue;
            }
            if (line === '}') {
                depth--;
                this.pos++;
                if (depth <= 0) break;
                continue;
            }

            // nested package → flatten
            const nestedPkg = line.match(/^package\s+"?([^"<{]+)"?\s*(?:<<\w+>>)?\s*\{?/);
            if (nestedPkg) {
                this.pos++;
                const nested = this.parsePackageBody(contextName);
                classes.push(...nested.classes);
                associations.push(...nested.associations);
                continue;
            }

            const classInfo = this.tryParseClassHeader(line, contextName);
            if (classInfo) {
                this.pos++;
                const {cls, needsBody} = classInfo;
                if (needsBody) {
                    const {fields, methods, permissions} = this.parseClassBody(cls.stereotype);
                    cls.fields = fields;
                    cls.methods = methods;
                    cls.permissions = permissions;
                }
                classes.push(cls);
                continue;
            }

            const assoc = this.tryParseAssociation(line);
            if (assoc) {
                associations.push(assoc);
                this.pos++;
                continue;
            }

            // note / annotation lines — skip
            if (line.startsWith('note') || line.startsWith('end note') || line.startsWith('..')) {
                this.pos++;
                continue;
            }

            this.pos++;
        }

        return {classes, associations};
    }

    // ─── Class header ─────────────────────────────────────────────────────────

    private tryParseClassHeader(
        line: string,
        contextName: string
    ): { cls: DomainClass; needsBody: boolean } | null {
        // class|interface|abstract class ClassName <<Stereotype>> [extends Parent] [{]
        const m = line.match(
            /^(abstract\s+class|class|interface)\s+(\w+)\s*(?:<<([^>]+)>>)?\s*(?:extends\s+(\w+))?\s*(\{)?/
        );
        if (!m) return null;

        const [, keyword, name, rawStereo, _extendsName, hasBody] = m;

        // Determine stereotype
        let stereotype: DddStereotype = 'Entity';
        if (rawStereo) {
            stereotype = parseStereotype(rawStereo) ?? 'Entity';
        }
        // Interface without explicit stereotype → Repository
        if (keyword.includes('interface') && !rawStereo) {
            stereotype = 'Repository';
        }

        const cls: DomainClass = {
            name,
            stereotype,
            boundedContext: contextName,
            fields: [],
            methods: [],
            isAbstract: keyword.includes('abstract'),
            isMutable: stereotype !== 'ValueObject' && stereotype !== 'DomainEvent',
            permissions: [],
        };

        return {cls, needsBody: hasBody === '{'};
    }

    // ─── Class body ───────────────────────────────────────────────────────────

    private parseClassBody(
        stereotype: DddStereotype
    ): { fields: DomainField[]; methods: DomainMethod[]; permissions: string[] } {
        const fields: DomainField[] = [];
        const methods: DomainMethod[] = [];
        const permissions: string[] = [];

        while (this.pos < this.lines.length) {
            const line = this.lines[this.pos];

            if (line === '}') {
                this.pos++;
                break;
            }
            if (line === '--' || line === '==' || line === '__') {
                this.pos++;
                continue;
            }

            // Role permission lines: all-caps identifiers, optionally followed by
            // a target operation (`MANAGE_STUDENTS : Student.manage`).
            const permissionLine = line.match(/^([A-Z][A-Z0-9_]+)\s*(?::.*)?$/);
            if (stereotype === 'Role' && permissionLine) {
                permissions.push(permissionLine[1]);
                this.pos++;
                continue;
            }

            // Method: has parentheses
            if (line.includes('(') && line.includes(')')) {
                const method = parseMethod(line);
                if (method) methods.push(method);
                this.pos++;
                continue;
            }

            // Field: has colon
            if (line.includes(':')) {
                const field = parseField(line);
                if (field) fields.push(field);
                this.pos++;
                continue;
            }

            this.pos++;
        }

        return {fields, methods, permissions};
    }

    // ─── Association ─────────────────────────────────────────────────────────

    private tryParseAssociation(line: string): DomainAssociation | null {
        // ClassName "mult" ARROW "mult" OtherClass : label
        // Patterns: --, -->, <--, .., ..>, *--, o--, --|>, ..|>
        const m = line.match(
            /^(\w+)\s*(?:"([^"]*)")?\s*([<>|o*.\-]{2,})\s*(?:"([^"]*)")?\s*(\w+)\s*(?::\s*(.+))?$/
        );
        if (!m) return null;

        const [, src, srcMult, arrow, tgtMult, tgt, label] = m;
        if (src === tgt) return null; // self-referential — skip

        return {
            sourceClass: src,
            targetClass: tgt,
            type: parseAssociationType(arrow),
            sourceMultiplicity: normalizeMultiplicity(srcMult ?? '1'),
            targetMultiplicity: normalizeMultiplicity(tgtMult ?? '1'),
            label: label?.trim() ?? '',
        };
    }

    // ─── App name from file path ──────────────────────────────────────────────

    private extractAppName(filePath: string): string {
        const base = filePath.split(/[\\/]/).pop() ?? 'app';
        return base.replace(/\.puml?$/i, '');
    }
}
