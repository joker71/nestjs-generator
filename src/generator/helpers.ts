/**
 * Handlebars Helpers — string transformations for template rendering
 */

import Handlebars from 'handlebars';
import {
    pascalCase,
    camelCase,
    snakeCase,
    kebabCase,
    constantCase,
} from 'change-case';

export function registerHelpers(): void {
    // ── Case transformers ─────────────────────────────────────────────────────
    Handlebars.registerHelper('pascal', (s: string) => pascalCase(s ?? ''));
    Handlebars.registerHelper('camel', (s: string) => camelCase(s ?? ''));
    Handlebars.registerHelper('kebab', (s: string) => kebabCase(s ?? ''));
    Handlebars.registerHelper('snake', (s: string) => snakeCase(s ?? ''));
    Handlebars.registerHelper('uppercase', (s: string) => constantCase(s ?? ''));
    Handlebars.registerHelper('capitalize', (s: string) =>
        s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
    );
    Handlebars.registerHelper('lowercase', (s: string) => (s ?? '').toLowerCase());

    // ── Pipe operator: {{value | helperName}} ────────────────────────────────
    // Handlebars doesn't support | natively — use as block: {{uppercase name}}
    // Already handled above. Alias:
    Handlebars.registerHelper('toUpper', (s: string) => constantCase(s ?? ''));

    // ── Comparison helpers ────────────────────────────────────────────────────
    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
    Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b);
    Handlebars.registerHelper('not', (v: unknown) => !v);
    Handlebars.registerHelper('and', (a: unknown, b: unknown) => Boolean(a) && Boolean(b));
    Handlebars.registerHelper('or', (a: unknown, b: unknown) => Boolean(a) || Boolean(b));
    Handlebars.registerHelper('startsWith', (s: string, prefix: string) =>
        typeof s === 'string' && s.startsWith(prefix)
    );

    // ── Array helpers ─────────────────────────────────────────────────────────
    Handlebars.registerHelper('first', (arr: unknown[]) => arr?.[0]);
    Handlebars.registerHelper('firstParam', (params: Array<{ name: string }>) =>
        params?.[0]?.name ?? 'entity'
    );
    Handlebars.registerHelper('join', (arr: string[], sep: string) =>
        Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : ''
    );
    Handlebars.registerHelper('length', (arr: unknown[]) => arr?.length ?? 0);
    Handlebars.registerHelper('hasItems', (arr: unknown[]) => Array.isArray(arr) && arr.length > 0);

    // ── DDD-specific helpers ──────────────────────────────────────────────────

    /** Infers the entity name from a repository class name: IStudentRepository → Student */
    Handlebars.registerHelper('entityFromRepo', (name: string) =>
        name.replace(/^I/, '').replace(/Repository$/, '')
    );

    /** Generate a NestJS injection token symbol name */
    Handlebars.registerHelper('tokenName', (name: string) =>
        `${constantCase(name)}_REPOSITORY_TOKEN`
    );

    /** Map TypeScript type to a simple display string */
    Handlebars.registerHelper('displayType', (type: string) =>
        type?.replace(/Promise<(.+)>/, '$1')
    );
}
