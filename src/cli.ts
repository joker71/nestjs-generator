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
        'Inspired by AGL/DCSL (Le & Dang), RBAC1 (Sandhu96), Layered Microservices'
    )
    .version('1.0.0');

program
    .command('generate')
    .alias('g')
    .description('Parse PlantUML and generate NestJS DDD + RBAC code')
    .requiredOption('-i, --input <file>', 'Input PlantUML file (.puml)')
    .option('-o, --output <dir>', 'Output directory', './generated')
    .option(
        '-a, --activity <file>',
        'Companion PlantUML activity diagram (AGL behavioral input). Auto-detected as <input>.activity.puml if omitted.',
    )
    .option(
        '-c, --constraints <file>',
        'Companion OCL constraints file. Auto-detected as <input>.ocl if omitted.',
    )
    .option('--dry-run', 'Print what would be generated without writing files')
    .action(async (opts: { input: string; output: string; activity?: string; constraints?: string; dryRun?: boolean }) => {
        const inputPath = path.resolve(opts.input);
        const outputDir = path.resolve(opts.output);
        const activityPath = opts.activity ? path.resolve(opts.activity) : undefined;
        const constraintPath = opts.constraints ? path.resolve(opts.constraints) : undefined;

        if (!fs.existsSync(inputPath)) {
            console.error(chalk.red(`x Input file not found: ${inputPath}`));
            process.exit(1);
        }
        if (constraintPath && !fs.existsSync(constraintPath)) {
            console.error(chalk.red(`x OCL file not found: ${constraintPath}`));
            process.exit(1);
        }

        console.log(chalk.cyan('\nDDD codegen - DDD + RBAC NestJS Generator\n'));
        console.log(chalk.gray(`  Input : ${inputPath}`));
        console.log(chalk.gray(`  Output: ${outputDir}\n`));

        try {
            console.log(chalk.yellow('  [1/3] Parsing PlantUML + OCL...'));
            const parser = new PlantUmlParser();
            let model: DomainMetamodel = parser.parse(inputPath, activityPath, constraintPath);
            const activityNodeCount = model.boundedContexts
                .flatMap(c => c.classes)
                .reduce((n, c) => n + (c.activityNodes?.length ?? 0), 0);
            console.log(chalk.green(
                `        ok ${model.boundedContexts.length} bounded context(s), ${model.rbac.roles.length} role(s)` +
                (activityNodeCount ? `, ${activityNodeCount} AGL activity node(s)` : ''),
            ));
            printOclParseSummary(model);

            console.log(chalk.yellow('  [2/3] Applying DDD + RBAC transformations + OCL evaluation...'));
            const transformer = new ModelTransformer();
            model = transformer.transform(model);
            const totalClasses = model.boundedContexts.reduce((n, c) => n + c.classes.length, 0);
            console.log(chalk.green(`        ok ${totalClasses} classes enriched`));
            printOclEvaluationSummary(model);

            console.log(chalk.yellow('  [3/3] Generating NestJS TypeScript code...'));
            if (opts.dryRun) {
                console.log(chalk.gray('        dry-run - no files written'));
                printPlan(model);
            } else {
                fs.ensureDirSync(outputDir);
                const generator = new CodeGenerator(outputDir);
                generator.generate(model);
                console.log(chalk.green(`        ok Code written to ${outputDir}`));
                printSummary(model);
            }

            console.log(chalk.cyan('\nDone.\n'));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\nx Error: ${msg}\n`));
            if (process.env['DEBUG']) console.error(err);
            process.exit(1);
        }
    });

program
    .command('inspect')
    .description('Parse PlantUML and print the intermediate metamodel as JSON')
    .requiredOption('-i, --input <file>', 'Input PlantUML file (.puml)')
    .option(
        '-a, --activity <file>',
        'Companion PlantUML activity diagram (AGL behavioral input). Auto-detected as <input>.activity.puml if omitted.',
    )
    .option(
        '-c, --constraints <file>',
        'Companion OCL constraints file. Auto-detected as <input>.ocl if omitted.',
    )
    .option('--transform', 'Apply transformations before printing')
    .action(async (opts: { input: string; activity?: string; constraints?: string; transform?: boolean }) => {
        const inputPath = path.resolve(opts.input);
        const activityPath = opts.activity ? path.resolve(opts.activity) : undefined;
        const constraintPath = opts.constraints ? path.resolve(opts.constraints) : undefined;

        if (!fs.existsSync(inputPath)) {
            console.error(chalk.red(`x File not found: ${inputPath}`));
            process.exit(1);
        }
        if (constraintPath && !fs.existsSync(constraintPath)) {
            console.error(chalk.red(`x OCL file not found: ${constraintPath}`));
            process.exit(1);
        }

        const parser = new PlantUmlParser();
        let model: DomainMetamodel = parser.parse(inputPath, activityPath, constraintPath);
        if (opts.transform) {
            const transformer = new ModelTransformer();
            model = transformer.transform(model);
        }
        console.log(JSON.stringify(model, null, 2));
    });

function printPlan(model: DomainMetamodel): void {
    model.boundedContexts.forEach(ctx => {
        console.log(chalk.bold(`\n    ${ctx.name}`));
        ctx.classes.forEach(cls => {
            console.log(chalk.gray(`       ${cls.stereotype.padEnd(15)} -> ${cls.name}`));
        });
    });
    console.log(chalk.bold('\n    RBAC'));
    model.rbac.roles.forEach(r => {
        console.log(chalk.gray(`       Role: ${r.name} (${r.permissions.length} permissions)`));
    });
}

function printSummary(model: DomainMetamodel): void {
    console.log(chalk.gray(`\n  Generated files:`));
    model.boundedContexts.forEach(ctx => {
        const aggregates = ctx.classes.filter(c => c.stereotype === 'AggregateRoot');
        const entities = ctx.classes.filter(c => c.stereotype === 'Entity');
        const vos = ctx.classes.filter(c => c.stereotype === 'ValueObject');
        const events = ctx.classes.filter(c => c.stereotype === 'DomainEvent');
        const services = ctx.classes.filter(c => c.stereotype === 'DomainService');

        console.log(chalk.bold(`\n    ${ctx.name}/`));
        if (aggregates.length) console.log(chalk.gray(`       ${aggregates.length} AggregateRoot(s) + controllers + repositories + use-cases`));
        if (entities.length) console.log(chalk.gray(`       ${entities.length} Entity/ies`));
        if (vos.length) console.log(chalk.gray(`       ${vos.length} ValueObject(s)`));
        if (events.length) console.log(chalk.gray(`       ${events.length} DomainEvent(s)`));
        if (services.length) console.log(chalk.gray(`       ${services.length} DomainService(s)`));
        console.log(chalk.gray(`       1 NestJS module`));
    });

    console.log(chalk.bold('\n    auth/'));
    console.log(chalk.gray(`       roles.enum.ts - ${model.rbac.roles.length} roles`));
    console.log(chalk.gray(`       permissions.enum.ts - ${model.rbac.allPermissions.length} permissions`));
    console.log(chalk.gray(`       role-permission.map.ts`));
    console.log(chalk.gray(`       rbac.guard.ts`));
    console.log(chalk.gray(`       decorators/permissions.decorator.ts`));
}

function printOclParseSummary(model: DomainMetamodel): void {
    if (!model.ocl) return;

    const contextCount = model.ocl.ast?.contexts.length ?? 0;
    const invariantCount = model.ocl.ast?.contexts.reduce((n, ctx) => n + ctx.invariants.length, 0) ?? 0;
    console.log(chalk.gray(`        OCL: ${contextCount} context(s), ${invariantCount} invariant(s)`));

    const errors = model.ocl.diagnostics.filter(d => d.severity === 'error');
    const warnings = model.ocl.diagnostics.filter(d => d.severity === 'warning');
    if (errors.length || warnings.length) {
        console.log(chalk.gray(`        OCL diagnostics: ${errors.length} error(s), ${warnings.length} warning(s)`));
    }
}

function printOclEvaluationSummary(model: DomainMetamodel): void {
    if (!model.ocl?.evaluations.length) return;

    const passed = model.ocl.evaluations.filter(e => e.status === 'passed').length;
    const failed = model.ocl.evaluations.filter(e => e.status === 'failed').length;
    const unsupported = model.ocl.evaluations.filter(e => e.status === 'unsupported').length;
    const errored = model.ocl.evaluations.filter(e => e.status === 'error').length;

    console.log(chalk.gray(
        `        OCL results: ${passed} passed, ${failed} failed, ${unsupported} unsupported, ${errored} error`,
    ));
}

program.parse(process.argv);
