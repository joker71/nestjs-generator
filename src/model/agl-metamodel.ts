//#region AGL
export interface AglActivityNode {
    label: string;
    refClass: string;          // referenced domain class (DomainClass.name)
    serviceClass: string;      // 'DataController' by default
    /** MAct sequence: ordered atomic actions (open→newObject→setDataFieldValues→createObject) */
    moduleActions: AglModuleAction[];
    outClasses: string[];      // target classes of outgoing edges
    isStart: boolean;          // ANode.init = true
    nodeType: 'Action' | 'Decision' | 'Fork' | 'Join' | 'Merge';
}

export interface AglModuleAction {
    actName: 'open' | 'newObject' | 'setDataFieldValues' | 'createObject' | 'updateObject' | 'deleteObject' | 'reset' | 'cancel';
    postStates: string[];      // e.g. ['Created'], ['NewObject']
    fieldNames?: string[];     // for setDataFieldValues
}