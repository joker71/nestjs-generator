import type {
    DomainMetamodel,
    OclInvariantEvaluation,
} from "../model/dcsl-metamodel";
import type {
    BinaryExpr,
    CollectionLiteralExpr,
    CollectionOpExpr,
    OclContext,
    OclDiagnostic,
    OclExpression,
    OclFile,
    PropertyCallExpr,
    QualifiedRefExpr,
} from "../parser/ocl/ocl-ast";

type RuntimeScalar = string | number | boolean | null;
type RuntimeValue =
    | RuntimeScalar
    | RuntimeTypeRef
    | RuntimeRole
    | RuntimePermission
    | RuntimeDomain
    | RuntimeValue[];

interface RuntimeTypeRef {
    kind: 'TypeRef';
    typeName: 'Role' | 'Permission' | 'Domain';
    domainName?: string;
}

interface RuntimePermission {
    kind: 'Permission';
    name: string;
    operation: string | null;
    target: string | null;
}

interface RuntimeRole {
    kind: 'Role';
    name: string;
    permissions: RuntimePermission[];
    effectivePermissions: RuntimePermission[];
    juniors: RuntimeRole[];
    seniors: RuntimeRole[];
    domain: RuntimeDomain | null;
    extendsRole?: string;
}

interface RuntimeDomain {
    kind: 'Domain';
    name: string;
    roles: RuntimeRole[];
}

interface RuntimeModel {
    roles: RuntimeRole[];
    permissions: RuntimePermission[];
    domains: Map<string, RuntimeDomain>;
}

interface EvalEnv {
    self: RuntimeValue;
    vars: Map<string, RuntimeValue>;
    runtime: RuntimeModel;
}

interface OclEvaluationResult {
    diagnostics: OclDiagnostic[];
    evaluations: OclInvariantEvaluation[];
}

class UnsupportedOclError extends Error {}

class OclRuntimeError extends Error {}

const IMPLICIT_PROPERTY = Symbol('implicit-property');

export class OclEvaluator {
    evaluateModel(model: DomainMetamodel, ast: OclFile): OclEvaluationResult {
        const runtime = this.buildRuntime(model);
        const diagnostics: OclDiagnostic[] = [];
        const evaluations: OclInvariantEvaluation[] = [];

        for (const context of ast.contexts) {
            const contextLabel = context.contextName.join('::');
            const invTargets = this.resolveContextTargets(context, runtime);

            if (invTargets.kind === 'unsupported') {
                for (const invariant of context.invariants) {
                    evaluations.push({
                        contextName: contextLabel,
                        invariantName: invariant.name ?? '(anonymous)',
                        status: 'unsupported',
                        message: invTargets.message,
                        evaluatedInstances: 0,
                    });
                }
                continue;
            }

            for (const invariant of context.invariants) {
                const failures: string[] = [];
                const unsupportedReasons = new Set<string>();
                const errors: string[] = [];

                for (const instance of invTargets.instances) {
                    const env: EvalEnv = {
                        self: instance,
                        vars: new Map<string, RuntimeValue>(),
                        runtime,
                    };

                    try {
                        const result = this.evaluateBoolean(invariant.body, env);
                        if (!result) failures.push(this.describeValue(instance));
                    } catch (error) {
                        if (error instanceof UnsupportedOclError) {
                            unsupportedReasons.add(error.message);
                            continue;
                        }
                        const message = error instanceof Error ? error.message : String(error);
                        errors.push(`${this.describeValue(instance)}: ${message}`);
                    }
                }

                const invariantName = invariant.name ?? '(anonymous)';
                if (errors.length > 0) {
                    evaluations.push({
                        contextName: contextLabel,
                        invariantName,
                        status: 'error',
                        message: errors.join('; '),
                        evaluatedInstances: invTargets.instances.length,
                    });
                    diagnostics.push({
                        severity: 'error',
                        message: `OCL runtime error in ${contextLabel}::${invariantName}: ${errors.join('; ')}`,
                        line: invariant.loc?.line,
                        column: invariant.loc?.column,
                    });
                    continue;
                }

                if (failures.length > 0) {
                    evaluations.push({
                        contextName: contextLabel,
                        invariantName,
                        status: 'failed',
                        message: `Violated by ${failures.join(', ')}`,
                        evaluatedInstances: invTargets.instances.length,
                        failingInstances: failures,
                    });
                    continue;
                }

                if (unsupportedReasons.size > 0) {
                    evaluations.push({
                        contextName: contextLabel,
                        invariantName,
                        status: 'unsupported',
                        message: [...unsupportedReasons].join('; '),
                        evaluatedInstances: invTargets.instances.length,
                    });
                    continue;
                }

                evaluations.push({
                    contextName: contextLabel,
                    invariantName,
                    status: 'passed',
                    message: `Evaluated on ${invTargets.instances.length} instance(s).`,
                    evaluatedInstances: invTargets.instances.length,
                });
            }
        }

        return {diagnostics, evaluations};
    }

    private buildRuntime(model: DomainMetamodel): RuntimeModel {
        const permissionNames = new Set<string>([
            ...model.rbac.allPermissions,
            ...model.rbac.roles.flatMap(role => role.permissions),
        ]);
        const permissionMap = new Map<string, RuntimePermission>();
        for (const permissionName of permissionNames) {
            permissionMap.set(permissionName, this.createPermission(permissionName));
        }

        const domainMap = new Map<string, RuntimeDomain>();
        for (const ctx of model.boundedContexts) {
            domainMap.set(ctx.name, {kind: 'Domain', name: ctx.name, roles: []});
        }
        for (const role of model.rbac.roles) {
            if (role.domain && !domainMap.has(role.domain)) {
                domainMap.set(role.domain, {kind: 'Domain', name: role.domain, roles: []});
            }
        }

        const roleMap = new Map<string, RuntimeRole>();
        for (const role of model.rbac.roles) {
            const runtimeRole: RuntimeRole = {
                kind: 'Role',
                name: role.name,
                permissions: role.permissions.map(name => permissionMap.get(name) ?? this.createPermission(name)),
                effectivePermissions: role.permissions.map(name => permissionMap.get(name) ?? this.createPermission(name)),
                juniors: [],
                seniors: [],
                domain: role.domain ? domainMap.get(role.domain) ?? null : null,
                extendsRole: role.extendsRole,
            };
            roleMap.set(role.name, runtimeRole);
        }

        for (const runtimeRole of roleMap.values()) {
            if (runtimeRole.domain) runtimeRole.domain.roles.push(runtimeRole);
            if (!runtimeRole.extendsRole) continue;
            const senior = roleMap.get(runtimeRole.extendsRole);
            if (!senior) continue;
            runtimeRole.seniors.push(senior);
            senior.juniors.push(runtimeRole);
        }

        return {
            roles: [...roleMap.values()],
            permissions: [...permissionMap.values()],
            domains: domainMap,
        };
    }

    private createPermission(name: string): RuntimePermission {
        const match = name.match(/^([A-Z0-9]+)_(.+)$/);
        return {
            kind: 'Permission',
            name,
            operation: match?.[1] ?? null,
            target: match?.[2] ?? null,
        };
    }

    private resolveContextTargets(
        context: OclContext,
        runtime: RuntimeModel,
    ): {kind: 'supported'; instances: RuntimeValue[]} | {kind: 'unsupported'; message: string} {
        try {
            return {
                kind: 'supported',
                instances: this.resolveAllInstances(this.makeTypeRef(context.contextName, runtime), runtime),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {kind: 'unsupported', message};
        }
    }

    private makeTypeRef(parts: string[], runtime: RuntimeModel): RuntimeTypeRef {
        const typeName = parts[parts.length - 1];
        if (typeName !== 'Role' && typeName !== 'Permission' && typeName !== 'Domain') {
            throw new UnsupportedOclError(
                `Context '${parts.join('::')}' chưa có dữ liệu runtime trong DomainMetamodel hiện tại.`,
            );
        }

        if (parts.length > 1) {
            const domainName = parts.slice(0, -1).join('::');
            if (!runtime.domains.has(domainName)) {
                throw new UnsupportedOclError(
                    `Namespace '${domainName}' chưa tồn tại trong mô hình runtime nên không thể đánh giá '${parts.join('::')}'.`,
                );
            }
            return {kind: 'TypeRef', typeName, domainName};
        }

        return {kind: 'TypeRef', typeName};
    }

    private resolveAllInstances(typeRef: RuntimeTypeRef, runtime: RuntimeModel): RuntimeValue[] {
        switch (typeRef.typeName) {
            case 'Role':
                return runtime.roles.filter(role => !typeRef.domainName || role.domain?.name === typeRef.domainName);
            case 'Permission':
                if (typeRef.domainName) {
                    throw new UnsupportedOclError('Permission hiện chưa được namespace theo domain trong runtime model.');
                }
                return runtime.permissions;
            case 'Domain':
                if (typeRef.domainName) {
                    const domain = runtime.domains.get(typeRef.domainName);
                    return domain ? [domain] : [];
                }
                return [...runtime.domains.values()];
        }
    }

    private evaluateBoolean(expr: OclExpression, env: EvalEnv): boolean {
        const value = this.evaluateExpression(expr, env);
        if (typeof value !== 'boolean') {
            throw new OclRuntimeError(`Invariant must evaluate to Boolean, got ${this.describeValue(value)}.`);
        }
        return value;
    }

    private evaluateExpression(expr: OclExpression, env: EvalEnv): RuntimeValue {
        switch (expr.kind) {
            case 'Let': {
                const vars = new Map(env.vars);
                for (const binding of expr.bindings) {
                    vars.set(binding.name, this.evaluateExpression(binding.value, {...env, vars}));
                }
                return this.evaluateExpression(expr.body, {...env, vars});
            }
            case 'If':
                return this.evaluateBoolean(expr.condition, env)
                    ? this.evaluateExpression(expr.thenExpr, env)
                    : this.evaluateExpression(expr.elseExpr, env);
            case 'Binary':
                return this.evaluateBinary(expr, env);
            case 'Unary':
                return this.evaluateUnary(expr.op, expr.operand, env);
            case 'PropertyCall':
                return this.evaluatePropertyCall(expr, env);
            case 'CollectionOp':
                return this.evaluateCollectionOp(expr, env);
            case 'Self':
                return env.self;
            case 'QualifiedRef':
                return this.evaluateQualifiedRef(expr, env);
            case 'Literal':
                return expr.value;
            case 'CollectionLiteral':
                return this.evaluateCollectionLiteral(expr, env);
        }
    }

    private evaluateBinary(expr: BinaryExpr, env: EvalEnv): RuntimeValue {
        switch (expr.op) {
            case 'implies': {
                const left = this.evaluateBoolean(expr.left, env);
                return !left || this.evaluateBoolean(expr.right, env);
            }
            case 'and':
                return this.evaluateBoolean(expr.left, env) && this.evaluateBoolean(expr.right, env);
            case 'or':
                return this.evaluateBoolean(expr.left, env) || this.evaluateBoolean(expr.right, env);
            case 'xor':
                return this.evaluateBoolean(expr.left, env) !== this.evaluateBoolean(expr.right, env);
        }

        const left = this.evaluateExpression(expr.left, env);
        const right = this.evaluateExpression(expr.right, env);

        switch (expr.op) {
            case '=':
                return this.equalsValue(left, right);
            case '<>':
                return !this.equalsValue(left, right);
            case '<':
                return this.asNumber(left) < this.asNumber(right);
            case '<=':
                return this.asNumber(left) <= this.asNumber(right);
            case '>':
                return this.asNumber(left) > this.asNumber(right);
            case '>=':
                return this.asNumber(left) >= this.asNumber(right);
            case '+':
                return this.asNumber(left) + this.asNumber(right);
            case '-':
                return this.asNumber(left) - this.asNumber(right);
            case '*':
                return this.asNumber(left) * this.asNumber(right);
            case '/':
                return this.asNumber(left) / this.asNumber(right);
        }
    }

    private evaluateUnary(op: 'not' | '-', operandExpr: OclExpression, env: EvalEnv): RuntimeValue {
        const operand = this.evaluateExpression(operandExpr, env);
        if (op === 'not') return !this.asBoolean(operand);
        return -this.asNumber(operand);
    }

    private evaluatePropertyCall(expr: PropertyCallExpr, env: EvalEnv): RuntimeValue {
        const source = this.evaluateExpression(expr.source, env);
        if (expr.args !== undefined) {
            if (expr.property === 'allInstances' && expr.args.length === 0 && this.isTypeRef(source)) {
                return this.resolveAllInstances(source, env.runtime);
            }
            throw new UnsupportedOclError(`Operation '.${expr.property}()' chưa được hỗ trợ trên runtime model.`);
        }

        if (Array.isArray(source)) {
            return this.flatten(source.map(item => this.readProperty(item, expr.property)));
        }

        return this.readProperty(source, expr.property);
    }

    private evaluateCollectionOp(expr: CollectionOpExpr, env: EvalEnv): RuntimeValue {
        const source = this.asCollection(this.evaluateExpression(expr.source, env));
        switch (expr.op) {
            case 'size':
                return source.length;
            case 'isEmpty':
                return source.length === 0;
            case 'notEmpty':
                return source.length > 0;
            case 'includes':
                return this.includesValue(source, this.singleArg(expr, env));
            case 'excludes':
                return !this.includesValue(source, this.singleArg(expr, env));
            case 'includesAll':
                return this.asCollection(this.singleArg(expr, env)).every(value => this.includesValue(source, value));
            case 'excludesAll':
                return this.asCollection(this.singleArg(expr, env)).every(value => !this.includesValue(source, value));
            case 'count': {
                const target = this.singleArg(expr, env);
                return source.filter(value => this.equalsValue(value, target)).length;
            }
            case 'sum':
                return source.reduce<number>((sum, value) => sum + this.asNumber(value), 0);
            case 'including':
                return [...source, this.singleArg(expr, env)];
            case 'excluding': {
                const target = this.singleArg(expr, env);
                return source.filter(value => !this.equalsValue(value, target));
            }
            case 'union':
                return this.uniqueValues([...source, ...this.asCollection(this.singleArg(expr, env))]);
            case 'intersection': {
                const other = this.asCollection(this.singleArg(expr, env));
                return source.filter(value => this.includesValue(other, value));
            }
            case 'symmetricDifference': {
                const other = this.asCollection(this.singleArg(expr, env));
                return this.uniqueValues([
                    ...source.filter(value => !this.includesValue(other, value)),
                    ...other.filter(value => !this.includesValue(source, value)),
                ]);
            }
            case 'asSet':
                return this.uniqueValues(source);
            case 'asBag':
            case 'asSequence':
            case 'asOrderedSet':
                return [...source];
            case 'flatten':
                return this.flatten(source);
            case 'first':
                return source[0] ?? null;
            case 'last':
                return source[source.length - 1] ?? null;
            case 'at': {
                const index = this.asNumber(this.singleArg(expr, env));
                return source[index - 1] ?? null;
            }
            case 'indexOf': {
                const target = this.singleArg(expr, env);
                const index = source.findIndex(value => this.equalsValue(value, target));
                return index >= 0 ? index + 1 : 0;
            }
            case 'forAll':
                return source.every(value => this.evaluateIteratorBoolean(expr, env, value));
            case 'exists':
                return source.some(value => this.evaluateIteratorBoolean(expr, env, value));
            case 'select':
                return source.filter(value => this.evaluateIteratorBoolean(expr, env, value));
            case 'reject':
                return source.filter(value => !this.evaluateIteratorBoolean(expr, env, value));
            case 'any':
                return source.find(value => this.evaluateIteratorBoolean(expr, env, value)) ?? null;
            case 'one':
                return source.filter(value => this.evaluateIteratorBoolean(expr, env, value)).length === 1;
            case 'collect':
                return this.flatten(source.map(value => this.evaluateIteratorExpression(expr, env, value)));
            case 'isUnique':
                return this.evaluateIsUnique(expr, env, source);
            case 'sortedBy':
                return this.evaluateSortedBy(expr, env, source);
            case 'closure':
                return this.evaluateClosure(expr, env, source);
            default:
                throw new UnsupportedOclError(`Collection op '->${expr.op}' chưa có evaluator runtime.`);
        }
    }

    private evaluateCollectionLiteral(expr: CollectionLiteralExpr, env: EvalEnv): RuntimeValue[] {
        return expr.elements.map(element => this.evaluateExpression(element, env));
    }

    private evaluateQualifiedRef(expr: QualifiedRefExpr, env: EvalEnv): RuntimeValue {
        if (expr.args !== undefined) {
            throw new UnsupportedOclError(`Call '${expr.parts.join('::')}(...)' chưa được hỗ trợ.`);
        }

        if (expr.parts.length === 1) {
            const localName = expr.parts[0];
            if (env.vars.has(localName)) return env.vars.get(localName)!;

            const implicit = this.tryReadImplicitProperty(env.self, localName);
            if (implicit !== IMPLICIT_PROPERTY) return implicit as RuntimeValue;
        }

        return this.makeTypeRef(expr.parts, env.runtime);
    }

    private evaluateIteratorBoolean(expr: CollectionOpExpr, env: EvalEnv, value: RuntimeValue): boolean {
        return this.asBoolean(this.evaluateIteratorExpression(expr, env, value));
    }

    private evaluateIteratorExpression(expr: CollectionOpExpr, env: EvalEnv, value: RuntimeValue): RuntimeValue {
        if (expr.iterators && expr.iterators.length > 1) {
            throw new UnsupportedOclError(`Iterator '${expr.op}' với nhiều biến chưa được hỗ trợ.`);
        }

        const vars = new Map(env.vars);
        if (expr.iterators?.[0]) vars.set(expr.iterators[0].name, value);
        if (expr.body) return this.evaluateExpression(expr.body, {...env, self: value, vars});

        if (expr.args?.length === 1 && expr.op === 'isUnique') {
            return this.evaluateExpression(expr.args[0], {...env, self: value, vars});
        }

        throw new OclRuntimeError(`Collection op '${expr.op}' thiếu iterator body.`);
    }

    private evaluateIsUnique(expr: CollectionOpExpr, env: EvalEnv, source: RuntimeValue[]): boolean {
        const seen = new Set<string>();
        for (const value of source) {
            const projected = this.evaluateIteratorExpression(expr, env, value);
            const key = this.valueKey(projected);
            if (seen.has(key)) return false;
            seen.add(key);
        }
        return true;
    }

    private evaluateSortedBy(expr: CollectionOpExpr, env: EvalEnv, source: RuntimeValue[]): RuntimeValue[] {
        return [...source].sort((left, right) => {
            const leftKey = this.evaluateIteratorExpression(expr, env, left);
            const rightKey = this.evaluateIteratorExpression(expr, env, right);
            if (typeof leftKey === 'number' && typeof rightKey === 'number') return leftKey - rightKey;
            return String(leftKey).localeCompare(String(rightKey));
        });
    }

    private evaluateClosure(expr: CollectionOpExpr, env: EvalEnv, source: RuntimeValue[]): RuntimeValue[] {
        if (!expr.body || !expr.iterators?.[0]) {
            throw new OclRuntimeError(`Collection op 'closure' yêu cầu iterator body.`);
        }

        const result = this.uniqueValues(source);
        const queue = [...result];
        const seen = new Set(result.map(value => this.valueKey(value)));

        while (queue.length > 0) {
            const current = queue.shift()!;
            const nextValues = this.asCollection(this.evaluateIteratorExpression(expr, env, current));
            for (const next of nextValues) {
                const key = this.valueKey(next);
                if (seen.has(key)) continue;
                seen.add(key);
                result.push(next);
                queue.push(next);
            }
        }

        return result;
    }

    private singleArg(expr: CollectionOpExpr, env: EvalEnv): RuntimeValue {
        if (!expr.args || expr.args.length !== 1) {
            throw new OclRuntimeError(`Collection op '${expr.op}' requires exactly one argument.`);
        }
        return this.evaluateExpression(expr.args[0], env);
    }

    private readProperty(source: RuntimeValue, property: string): RuntimeValue {
        if (source === null) return null;

        if (this.isRole(source)) {
            switch (property) {
                case 'name':
                    return source.name;
                case 'permissions':
                    return source.permissions;
                case 'effectivePermissions':
                    return source.effectivePermissions;
                case 'juniors':
                    return source.juniors;
                case 'seniors':
                    return source.seniors;
                case 'domain':
                    return source.domain;
                default:
                    throw new UnsupportedOclError(`Thuộc tính Role.${property} chưa có trong runtime model hiện tại.`);
            }
        }

        if (this.isPermission(source)) {
            switch (property) {
                case 'name':
                    return source.name;
                case 'operation':
                    return source.operation;
                case 'target':
                    return source.target;
                default:
                    throw new UnsupportedOclError(`Thuộc tính Permission.${property} chưa có trong runtime model hiện tại.`);
            }
        }

        if (this.isDomain(source)) {
            switch (property) {
                case 'name':
                    return source.name;
                case 'roles':
                    return source.roles;
                default:
                    throw new UnsupportedOclError(`Thuộc tính Domain.${property} chưa có trong runtime model hiện tại.`);
            }
        }

        throw new UnsupportedOclError(`Không thể truy cập thuộc tính '${property}' trên ${this.describeValue(source)}.`);
    }

    private tryReadImplicitProperty(source: RuntimeValue, property: string): RuntimeValue | typeof IMPLICIT_PROPERTY {
        try {
            return this.readProperty(source, property);
        } catch (error) {
            if (error instanceof UnsupportedOclError) return IMPLICIT_PROPERTY;
            throw error;
        }
    }

    private isTypeRef(value: RuntimeValue): value is RuntimeTypeRef {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'TypeRef';
    }

    private isRole(value: RuntimeValue): value is RuntimeRole {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'Role';
    }

    private isPermission(value: RuntimeValue): value is RuntimePermission {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'Permission';
    }

    private isDomain(value: RuntimeValue): value is RuntimeDomain {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'Domain';
    }

    private asCollection(value: RuntimeValue): RuntimeValue[] {
        if (Array.isArray(value)) return value;
        if (value === null) return [];
        return [value];
    }

    private asBoolean(value: RuntimeValue): boolean {
        if (typeof value !== 'boolean') {
            throw new OclRuntimeError(`Expected Boolean, got ${this.describeValue(value)}.`);
        }
        return value;
    }

    private asNumber(value: RuntimeValue): number {
        if (typeof value !== 'number') {
            throw new OclRuntimeError(`Expected Number, got ${this.describeValue(value)}.`);
        }
        return value;
    }

    private equalsValue(left: RuntimeValue, right: RuntimeValue): boolean {
        if (Array.isArray(left) && Array.isArray(right)) {
            if (left.length !== right.length) return false;
            return left.every((value, index) => this.equalsValue(value, right[index]));
        }
        return this.valueKey(left) === this.valueKey(right);
    }

    private includesValue(collection: RuntimeValue[], value: RuntimeValue): boolean {
        return collection.some(item => this.equalsValue(item, value));
    }

    private uniqueValues(values: RuntimeValue[]): RuntimeValue[] {
        const map = new Map<string, RuntimeValue>();
        for (const value of values) {
            map.set(this.valueKey(value), value);
        }
        return [...map.values()];
    }

    private flatten(values: RuntimeValue[]): RuntimeValue[] {
        const result: RuntimeValue[] = [];
        for (const value of values) {
            if (Array.isArray(value)) result.push(...value);
            else result.push(value);
        }
        return result;
    }

    private valueKey(value: RuntimeValue): string {
        if (Array.isArray(value)) {
            return `Collection:[${value.map(item => this.valueKey(item)).join(',')}]`;
        }
        if (this.isRole(value)) return `Role:${value.name}`;
        if (this.isPermission(value)) return `Permission:${value.name}`;
        if (this.isDomain(value)) return `Domain:${value.name}`;
        if (this.isTypeRef(value)) return `TypeRef:${value.domainName ?? '*'}/${value.typeName}`;
        return `${typeof value}:${String(value)}`;
    }

    private describeValue(value: RuntimeValue): string {
        if (Array.isArray(value)) return `[${value.map(item => this.describeValue(item)).join(', ')}]`;
        if (this.isRole(value)) return `Role(${value.name})`;
        if (this.isPermission(value)) return `Permission(${value.name})`;
        if (this.isDomain(value)) return `Domain(${value.name})`;
        if (this.isTypeRef(value)) return `${value.domainName ? `${value.domainName}::` : ''}${value.typeName}`;
        if (value === null) return 'null';
        return String(value);
    }
}
