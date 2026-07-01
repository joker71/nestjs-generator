import {readFileSync, existsSync} from 'node:fs';
import type {AglActivityNode, AglActNameType, AglModuleAction, AglNoteType} from '../model/agl-metamodel';

/**
 * AGL Activity Diagram Parser
 * ───────────────────────────
 * Fills the gap in ddd-codegen's input: until now only PlantUML *class* diagrams
 * were parsed (DCSL structure). The AGL metamodel (AglActivityNode / AglModuleAction)
 * existed but had no way to be populated from a diagram — this parser is that input.
 *
 * Convention (companion file `<name>.activity.puml`, auto-detected next to `<name>.puml`,
 * or passed explicitly via `-a/--activity`):
 *
 *   |ClassOrUseCaseName|      swimlane — sets the current ANode.refClass for the
 *                             action lines that follow, until the next swimlane.
 *   start                     marks the very next action node as ANode.init = true.
 *   :open;                    AGL MAct keyword — no args.
 *   :newObject(Student);      AGL MAct keyword — optional single arg overrides refClass
 *                             for this node (useful when there is no swimlane).
 *   :setDataFieldValues(name, email);   AGL MAct keyword — args become fieldNames.
 *   :createObject(Student) <<Created>>; AGL MAct keyword — optional <<PostState>> tag
 *                             overrides the default post-state for that action.
 *   :Some free-text label;    generic Action node (nodeType='Action'); moduleAction is
 *                             best-effort inferred from the label's leading verb.
 *   if (cond?) then (yes) / else (no) / endif   → Decision node; branch heads become
 *                             the decision node's outClasses (outgoing edges).
 *   fork / fork again / end fork                → Fork/Join nodes, same branching rule.
 *   stop / end                end of flow — no node emitted.
 *
 * Consecutive MAct lines under the same swimlane are grouped into ONE AglActivityNode
 * with an ordered `moduleActions` list (AGL Structured Atomic Action / SAA sequence,
 * e.g. open → newObject → setDataFieldValues → createObject). Edges between nodes
 * (`outClasses`) are derived from the diagram's control flow, not just line order.
 */

const MACT_KEYWORDS: Record<string, AglActNameType> = {
    open: 'open',
    newobject: 'newObject',
    setdatafieldvalues: 'setDataFieldValues',
    createobject: 'createObject',
    updateobject: 'updateObject',
    deleteobject: 'deleteObject',
    reset: 'reset',
    cancel: 'cancel',
};

const DEFAULT_POST_STATE: Record<AglActNameType, string[]> = {
    open: [],
    newObject: ['NewObject'],
    setDataFieldValues: ['FieldsSet'],
    createObject: ['Created'],
    updateObject: ['Updated'],
    deleteObject: ['Deleted'],
    reset: ['Reset'],
    cancel: ['Cancelled'],
};

// Reuses the same free-text → MAct inference table as ModelTransformer so a plain
// English label (":Register Student;") still yields a best-guess moduleAction.
const LABEL_KEYWORDS: Record<string, AglActNameType> = {
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

function inferActNameFromLabel(label: string): AglActNameType | undefined {
    const lower = label.toLowerCase();
    for (const [kw, act] of Object.entries(LABEL_KEYWORDS)) {
        if (lower.startsWith(kw)) return act;
    }
    return undefined;
}

function dedupe(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

interface BlockFrame {
    kind: 'if' | 'fork';
    nodeIndex: number;          // index of the Decision/Fork node in `nodes`
    branchStarts: number[];     // index of the first node of each branch seen so far
    branchOpen: boolean;        // true right after then/else/fork-again, before the branch's first node is seen
}

export class ActivityDiagramParser {
    private lines: string[] = [];
    private pos = 0;

    private nodes: AglActivityNode[] = [];
    private explicitOut = new Map<number, string[]>();
    private noAutoNext = new Set<number>();
    private awaitingContinuation: number[] = [];
    private blockStack: BlockFrame[] = [];

    private currentRefClass = 'Unknown';
    private startPending = false;

    private pendingActNames: AglModuleAction[] = [];
    private pendingRefClass: string | null = null;
    private pendingIsStart = false;

    static fileExists(path: string): boolean {
        return existsSync(path);
    }

    parse(filePath: string): AglActivityNode[] {
        const src = readFileSync(filePath, 'utf-8');
        return this.parseSource(src);
    }

    parseSource(src: string): AglActivityNode[] {
        this.lines = src
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith("'") && l !== '@startuml' && !l.startsWith('@startuml ') && l !== '@enduml');
        this.pos = 0;

        this.nodes = [];
        this.explicitOut = new Map();
        this.noAutoNext = new Set();
        this.awaitingContinuation = [];
        this.blockStack = [];
        this.currentRefClass = 'Unknown';
        this.startPending = false;
        this.flushPending(false);

        while (this.pos < this.lines.length) {
            const line = this.lines[this.pos];
            this.consumeLine(line);
            this.pos++;
        }

        // Flush any trailing MAct group that never hit an explicit terminator.
        this.flushPending(false);

        this.resolveOutEdges();
        return this.nodes;
    }

    // ─── Line dispatch ────────────────────────────────────────────────────────

    private consumeLine(line: string): void {
        // Swimlane
        const lane = line.match(/^\|([^|]+)\|$/);
        if (lane) {
            this.flushPending(false);
            this.currentRefClass = lane[1].trim();
            return;
        }

        if (line === 'start') {
            this.flushPending(false);
            this.startPending = true;
            return;
        }

        if (line === 'stop' || line === 'end') {
            this.flushPending(false);
            return;
        }

        // Decision open: if (cond) then (label)
        const ifMatch = line.match(/^if\s*\(([^)]*)\)\s*then\b/i);
        if (ifMatch) {
            this.flushPending(false);
            const node = this.pushNode({
                label: ifMatch[1].trim(),
                refClass: this.currentRefClass,
                serviceClass: 'DataController',
                moduleActions: [],
                outClasses: [],
                isStart: this.consumeStartFlag(),
                nodeType: 'Decision',
            });
            this.blockStack.push({kind: 'if', nodeIndex: node, branchStarts: [], branchOpen: true});
            return;
        }

        if (/^else\b/i.test(line)) {
            this.flushPending(false);
            const frame = this.currentIfFrame();
            if (frame) {
                // The branch just finished must not auto-link to the next branch —
                // it should instead flow to whatever comes after `endif`.
                this.closeBranch(frame);
                frame.branchOpen = true;
            }
            return;
        }

        if (/^endif\b/i.test(line)) {
            this.flushPending(false);
            const frame = this.blockStack.pop();
            if (frame) {
                this.closeBranch(frame);
                this.explicitOut.set(frame.nodeIndex, frame.branchStarts.map(i => this.nodes[i].refClass));
            }
            return;
        }

        if (/^fork\s+again\b/i.test(line)) {
            this.flushPending(false);
            const frame = this.currentForkFrame();
            if (frame) {
                this.closeBranch(frame);
                frame.branchOpen = true;
            }
            return;
        }

        if (/^fork\b/i.test(line)) {
            this.flushPending(false);
            const node = this.pushNode({
                label: 'fork',
                refClass: this.currentRefClass,
                serviceClass: 'DataController',
                moduleActions: [],
                outClasses: [],
                isStart: this.consumeStartFlag(),
                nodeType: 'Fork',
            });
            this.blockStack.push({kind: 'fork', nodeIndex: node, branchStarts: [], branchOpen: true});
            return;
        }

        if (/^end\s*fork\b/i.test(line)) {
            this.flushPending(false);
            const frame = this.blockStack.pop();
            if (frame) {
                this.closeBranch(frame);
                this.explicitOut.set(frame.nodeIndex, frame.branchStarts.map(i => this.nodes[i].refClass));
                // The join point itself becomes a node so downstream flow has somewhere to land.
                const joinIdx = this.pushNode({
                    label: 'join',
                    refClass: this.currentRefClass,
                    serviceClass: 'DataController',
                    moduleActions: [],
                    outClasses: [],
                    isStart: false,
                    nodeType: 'Join',
                });
            }
            return;
        }

        // Action node: :label;  or  :label <<PostState>>;
        const action = line.match(/^:(.*?);?$/);
        if (action) {
            this.consumeAction(action[1].trim());
            return;
        }

        // Unrecognised line (comments, notes, arrows) — ignore.
    }

    private consumeAction(raw: string): void {
        let text = raw;
        let explicitPostState: string | undefined;

        const tagged = text.match(/^(.*?)\s*<<(\w+)>>$/);
        if (tagged) {
            text = tagged[1].trim();
            explicitPostState = tagged[2];
        }

        const call = text.match(/^(\w+)\s*(?:\(([^)]*)\))?$/);
        const keyword = call ? MACT_KEYWORDS[call[1].toLowerCase()] : undefined;

        if (call && keyword) {
            // Args are informational metadata (e.g. the entity instantiated by
            // newObject(Student), or the fields touched by setDataFieldValues(...)).
            // refClass always comes from the current swimlane so a whole SAA
            // sequence (open → newObject → ... → createObject) groups into ONE
            // AglActivityNode instead of splitting on every argument.
            const args = (call[2] ?? '').split(',').map(s => s.trim()).filter(Boolean);
            const fieldNames = args.length ? args : undefined;
            const targetRefClass = this.currentRefClass;

            if (this.pendingRefClass === null) {
                this.pendingRefClass = targetRefClass;
                this.pendingIsStart = this.consumeStartFlag();
            }

            this.pendingActNames.push({
                actName: keyword,
                postStates: explicitPostState ? [explicitPostState] : DEFAULT_POST_STATE[keyword],
                fieldNames,
            });
            return;
        }

        // Generic free-text action — flush any accumulated MAct group first, then
        // emit its own single node.
        this.flushPending(false);
        const inferred = inferActNameFromLabel(text);
        this.pushNode({
            label: text,
            refClass: this.currentRefClass,
            serviceClass: 'DataController',
            moduleActions: inferred
                ? [{actName: inferred, postStates: explicitPostState ? [explicitPostState] : DEFAULT_POST_STATE[inferred]}]
                : [],
            outClasses: [],
            isStart: this.consumeStartFlag(),
            nodeType: 'Action',
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private consumeStartFlag(): boolean {
        const v = this.startPending;
        this.startPending = false;
        return v;
    }

    private flushPending(_forceIsStart: boolean): void {
        if (this.pendingActNames.length === 0 || this.pendingRefClass === null) {
            this.pendingActNames = [];
            this.pendingRefClass = null;
            return;
        }
        this.pushNode({
            label: `${this.pendingRefClass}: ${this.pendingActNames.map(a => a.actName).join(' → ')}`,
            refClass: this.pendingRefClass,
            serviceClass: 'DataController',
            moduleActions: this.pendingActNames,
            outClasses: [],
            isStart: this.pendingIsStart,
            nodeType: 'Action',
        });
        this.pendingActNames = [];
        this.pendingRefClass = null;
        this.pendingIsStart = false;
    }

    private pushNode(node: AglActivityNode): number {
        const idx = this.nodes.length;
        this.nodes.push(node);

        if (this.awaitingContinuation.length) {
            for (const i of this.awaitingContinuation) {
                const existing = this.explicitOut.get(i) ?? [];
                this.explicitOut.set(i, dedupe([...existing, node.refClass]));
            }
            this.awaitingContinuation = [];
        }

        // Registering as a branch start for whichever if/fork block is open.
        const frame = this.blockStack[this.blockStack.length - 1];
        if (frame && frame.branchOpen && idx !== frame.nodeIndex) {
            frame.branchStarts.push(idx);
            frame.branchOpen = false;
        }

        return idx;
    }

    private currentIfFrame(): BlockFrame | undefined {
        return [...this.blockStack].reverse().find(f => f.kind === 'if');
    }

    private currentForkFrame(): BlockFrame | undefined {
        return [...this.blockStack].reverse().find(f => f.kind === 'fork');
    }

    /** Marks the last node of the currently-open branch as needing a continuation link
     *  instead of a plain "next line" link (it must not fall through to the next branch). */
    private closeBranch(frame: BlockFrame): void {
        if (frame.branchOpen) return; // branch never got a body — nothing to close
        const lastBranchNodeIdx = this.lastPushedNodeIndex();
        if (lastBranchNodeIdx !== null && lastBranchNodeIdx !== frame.nodeIndex) {
            this.noAutoNext.add(lastBranchNodeIdx);
            this.awaitingContinuation.push(lastBranchNodeIdx);
        }
    }

    private lastPushedNodeIndex(): number | null {
        return this.nodes.length ? this.nodes.length - 1 : null;
    }

    private resolveOutEdges(): void {
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.explicitOut.has(i)) {
                this.nodes[i].outClasses = dedupe(this.explicitOut.get(i)!);
            } else if (!this.noAutoNext.has(i) && i + 1 < this.nodes.length) {
                this.nodes[i].outClasses = dedupe([this.nodes[i + 1].refClass]);
            } else {
                this.nodes[i].outClasses = this.nodes[i].outClasses ?? [];
            }
        }
    }
}
