#!/usr/bin/env ts-node


import {Command} from 'commander';
import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';

import {PlantUmlParser} from './parser/plantuml-parser';
import {ModelTransformer} from './transformer/model-transformer';
import {CodeGenerator} from './generator/code-generator';
import {DomainMetamodel} from "./model/dcsl-metamodel";

const program = new Command();

program
    .name('ddd-codegen')
    .description(
        'DDD + RBAC NestJS Code Generator from PlantUML\n' +
        'Inspired by AGL/DCSL (Le & Dang), RBAC₁ (Sandhu96), Layered Microservices'
    )
    .version('1.0.0');

// ─── generate command ─────────────────────────────────────────────────────────

program
    .command('generate')
    .alias('g')
    .description('Parse PlantUML and generate NestJS DDD + RBAC code')
    .requiredOption('-i, --input <file>', 'Input PlantUML file (.puml)')
    .option('-o, --output <dir>', 'Output directory', './generated')
    .option('--dry-run', 'Print what would be generated without writing files')
    .action(async (opts: { input: string; output: string; dryRun?: boolean }) => {
        const inputPath = path.resolve(opts.input);
        const outputDir = path.resolve(opts.output);

        if (!fs.existsSync(inputPath)) {
            console.error(chalk.red(`✗ Input file not found: ${inputPath}`));
            process.exit(1);
        }

        console.log(chalk.cyan('\n🚀 ddd-codegen — DDD + RBAC NestJS Generator\n'));
        console.log(chalk.gray(`  Input : ${inputPath}`));
        console.log(chalk.gray(`  Output: ${outputDir}\n`));

        try {
            // Step 1 — Parse
            console.log(chalk.yellow('  [1/3] Parsing PlantUML...'));
            const parser = new PlantUmlParser();
            let model: DomainMetamodel = parser.parse(inputPath);
            console.log(chalk.green(`        ✓ ${model.boundedContexts.length} bounded context(s), ${model.rbac.roles.length} role(s)`));

            // Step 2 — Transform
            console.log(chalk.yellow('  [2/3] Applying DDD + RBAC transformations...'));
            const transformer = new ModelTransformer();
            model = transformer.transform(model);
            const totalClasses = model.boundedContexts.reduce((n, c) => n + c.classes.length, 0);
            console.log(chalk.green(`        ✓ ${totalClasses} classes enriched`));

            // Step 3 — Generate
            console.log(chalk.yellow('  [3/3] Generating NestJS TypeScript code...'));
            if (opts.dryRun) {
                console.log(chalk.gray('        (dry-run — no files written)'));
                printPlan(model, outputDir);
            } else {
                fs.ensureDirSync(outputDir);
                const generator = new CodeGenerator(outputDir);
                generator.generate(model);
                console.log(chalk.green(`        ✓ Code written to ${outputDir}`));
                printSummary(model, outputDir);
            }

            console.log(chalk.cyan('\n✅ Done!\n'));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\n✗ Error: ${msg}\n`));
            if (process.env['DEBUG']) console.error(err);
            process.exit(1);
        }
    });

// ─── inspect command ──────────────────────────────────────────────────────────

program
    .command('inspect')
    .description('Parse PlantUML and print the intermediate metamodel as JSON')
    .requiredOption('-i, --input <file>', 'Input PlantUML file (.puml)')
    .option('--transform', 'Apply transformations before printing')
    .action(async (opts: { input: string; transform?: boolean }) => {
        const inputPath = path.resolve(opts.input);
        if (!fs.existsSync(inputPath)) {
            console.error(chalk.red(`✗ File not found: ${inputPath}`));
            process.exit(1);
        }
        const parser = new PlantUmlParser();
        let model: DomainMetamodel = parser.parse(inputPath);
        if (opts.transform) {
            const transformer = new ModelTransformer();
            model = transformer.transform(model);
        }
        console.log(JSON.stringify(model, null, 2));
    });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printPlan(model: DomainMetamodel, outDir: string): void {
    model.boundedContexts.forEach(ctx => {
        console.log(chalk.bold(`\n    📦 ${ctx.name}`));
        ctx.classes.forEach(cls => {
            console.log(chalk.gray(`       ${cls.stereotype.padEnd(15)} → ${cls.name}`));
        });
    });
    console.log(chalk.bold('\n    🔐 RBAC'));
    model.rbac.roles.forEach(r => {
        console.log(chalk.gray(`       Role: ${r.name} (${r.permissions.length} permissions)`));
    });
}

function printSummary(model: DomainMetamodel, outDir: string): void {
    let fileCount = 0;
    model.boundedContexts.forEach(ctx => {
        ctx.classes.forEach(() => fileCount++);
    });
    // +RBAC files
    fileCount += 5;

    console.log(chalk.gray(`\n  Generated files:`));
    model.boundedContexts.forEach(ctx => {
        const aggregates = ctx.classes.filter(c => c.stereotype === 'AggregateRoot');
        const entities = ctx.classes.filter(c => c.stereotype === 'Entity');
        const vos = ctx.classes.filter(c => c.stereotype === 'ValueObject');
        const events = ctx.classes.filter(c => c.stereotype === 'DomainEvent');
        const services = ctx.classes.filter(c => c.stereotype === 'DomainService');

        console.log(chalk.bold(`\n    📦 ${ctx.name}/`));
        if (aggregates.length) console.log(chalk.gray(`       ${aggregates.length} AggregateRoot(s) + controllers + repositories + use-cases`));
        if (entities.length) console.log(chalk.gray(`       ${entities.length} Entity/ies`));
        if (vos.length) console.log(chalk.gray(`       ${vos.length} ValueObject(s)`));
        if (events.length) console.log(chalk.gray(`       ${events.length} DomainEvent(s)`));
        if (services.length) console.log(chalk.gray(`       ${services.length} DomainService(s)`));
        console.log(chalk.gray(`       1 NestJS module`));
    });

    console.log(chalk.bold('\n    🔐 auth/'));
    console.log(chalk.gray(`       roles.enum.ts — ${model.rbac.roles.length} roles`));
    console.log(chalk.gray(`       permissions.enum.ts — ${model.rbac.allPermissions.length} permissions`));
    console.log(chalk.gray(`       role-permission.map.ts`));
    console.log(chalk.gray(`       rbac.guard.ts`));
    console.log(chalk.gray(`       decorators/permissions.decorator.ts`));
}

program.parse(process.argv);
