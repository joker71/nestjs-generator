import {AglActivityNode} from "./agl-metamodel";
import {RbacModel, RbacRole} from "./rbac-metamodel";

export type Visibility = 'private' | 'public' | 'protected';
export type AssociationType = 'composition' | 'aggregation' | 'association' | 'dependency' | 'realization';
export type Multiplicity = '0..1' | '1' | '0..*' | '1..*' | '*';
export type ActionType =
    "open" | "newObject" | "setDataFieldValues" | "createObject" | "updateObject" | "deleteObject"




//#region Dcsl
export type DddStereotype =
    | 'AggregateRoot'
    | 'Entity'
    | 'ValueObject'
    | 'DomainService'
    | 'DomainEvent'
    | 'Repository'
    | 'UseCase'
    | 'Role';

export interface DomainField {
    name: string;
    type: string;             // TypeScript type string
    visibility: Visibility;
    isOptional: boolean;      // DAttr.optional
    isCollection: boolean;    // DAssoc one-many / many-many
    isId: boolean;            // DOpt{type=AutoAttributeValueGen} → primary key
    defaultValue?: string;
}

export interface DomainMethod {
    name: string;
    visibility: Visibility;
    returnType: string;
    parameters: Array<{ name: string; type: string }>;
    isAsync: boolean;
    moduleAction?: string;
    // open | newObject | setDataFieldValues | createObject | updateObject | deleteObject
}

export interface DomainAssociation {
    sourceClass: string;
    targetClass: string;
    type: AssociationType;
    sourceMultiplicity: Multiplicity;
    targetMultiplicity: Multiplicity;
    label: string;
    sourceRole?: string;
    targetRole?: string;
}

export interface DomainClass {
    name: string;
    stereotype: DddStereotype;
    boundedContext: string;
    fields: DomainField[];
    methods: DomainMethod[];
    isAbstract: boolean;
    isMutable: boolean;
    permissions: string[];
    extendsRole?: string;
    activityNodes?: AglActivityNode[];
}


//#region bounded context

export interface BoundedContext {
    name: string;
    classes: DomainClass[];
    associations: DomainAssociation[];
}

//#region Top-level Metamodel

export interface DomainMetamodel {
    /** Project/app name */
    appName: string;
    boundedContexts: BoundedContext[];
    rbac: RbacModel;
}

//#region Generator context (passed to Handlebars templates)

export interface GeneratorContext {
    appName: string;
    className: string;
    classNameCamel: string;         // camelCase
    classNameKebab: string;         // kebab-case
    classNameSnake: string;         // snake_case
    contextName: string;
    contextNameCamel: string;
    contextNameKebab: string;
    fields: DomainField[];
    methods: DomainMethod[];
    associations: DomainAssociation[];
    stereotype: DddStereotype;
    isMutable: boolean;
    aggregateClass?: string;
    useCaseName?: string;
    roles?: RbacRole[];
    permissions?: string[];
}