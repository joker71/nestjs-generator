//#region AGL
export interface AglActivityNode {
    label: string;
    refClass: string;          // referenced domain class (DomainClass.name)
    serviceClass: string;      // 'DataController' by default
    /** MAct sequence: ordered atomic actions (open→newObject→setDataFieldValues→createObject) */
    moduleActions: AglModuleAction[];
    outClasses: string[];      // target classes of outgoing edges
    isStart: boolean;          // ANode.init = true
    nodeType: AglNoteType;
}

export interface AglModuleAction {
    actName: AglActNameType;
    postStates: string[];      // e.g. ['Created'], ['NewObject']
    fieldNames?: string[];     // for setDataFieldValues
}


export type  AglActNameType =
    'open' | 'newObject' | 'setDataFieldValues' | 'createObject' | 'updateObject' | 'deleteObject' | 'reset' | 'cancel';


export type AglNoteType =
    'Action' | 'Decision' | 'Fork' | 'Join' | 'Merge';