
Intermediate Metamodel — inspired by:
- DCSL (DClass, DAttr, DAssoc, DOpt) from "DDD with DCSL" paper
- AGL (AGraph, ANode, MAct) from "AGL: Incorporating Behavioral Aspects into DDD"
- RBAC₀/₁/₂ from Sandhu et al. 1996
- Layered Microservices (Bounded Context decomposition)


* DDD stereotypes — maps directly to DCSL meta-concepts and AGL activity patterns.
* AggregateRoot → DCSL DClass{mutable=true} + MOSA module owner
* Entity        → DCSL DClass{mutable=true}
* ValueObject   → DCSL DClass{mutable=false, immutable}
* DomainService → DCSL DOpt{type=Service}, sits at domain layer
* DomainEvent   → DCSL DClass{immutable}, emitted by aggregate actions (AGL MAct post-state)
* Repository    → DCSL DAssoc + interface to infrastructure
* UseCase       → AGL ANode (application-layer action sequence, SAA)
* Role          → RBAC Role (Sandhu96 RBAC₁)


/**
* Core metamodel unit. Maps to DCSL DClass (structural) + AGL ANode (behavioral).
*
* In MOSA terms, each DomainClass with stereotype AggregateRoot becomes the
* owner of a software module (ModuleClass = Domain + View + Controller).
  */



/**
* AGL ANode: represents an action node in the activity graph.
* Maps to a use-case action sequence (SAA) at the application layer.
* Corresponds to MOSA ModuleService action sequence.
  */


// ─── RBAC (Sandhu96 RBAC₁) ──────────────────────────────────────────────────

/**
* RBAC Role with permission assignment and role hierarchy.
* RBAC₀: users, roles, permissions, sessions
* RBAC₁: adds role hierarchy (extendsRole)
* RBAC₂: adds static separation of duty constraints
  */



/**
* AGL Activity Diagram Parser (src/parser/activity-parser.ts)
* ─────────────────────────────────────────────────────────
* Behavioral (AGL) input, previously missing — companion file `<name>.activity.puml`,
* auto-detected next to `<name>.puml` or passed via `-a/--activity`.
*
*   |ClassOrUseCaseName|         swimlane → ANode.refClass for following actions
*   start / stop                 marks ANode.init and end of flow
*   :open;                       AGL MAct keyword (no args)
*   :newObject(Student);         AGL MAct keyword (arg = informational, e.g. entity name)
*   :setDataFieldValues(a, b);   AGL MAct keyword (args = fieldNames)
*   :createObject(Student) <<Created>>;   optional <<PostState>> override
*   :Free text label;            generic Action node; moduleAction best-effort inferred
*   if (cond?) then (yes) / else (no) / endif   → Decision node, branches → outClasses
*   fork / fork again / end fork                → Fork/Join nodes, same branching rule
*
* Consecutive MAct lines under the same swimlane group into ONE AglActivityNode with
* an ordered `moduleActions` list (the AGL SAA sequence: open → newObject →
* setDataFieldValues → createObject). Parsed nodes are matched by `refClass` and
* attached to the corresponding `DomainClass.activityNodes`, then surfaced as a
* traceability comment on the generated use-case (see `use-case.hbs`).
*
* See examples/course-management.activity.puml for a worked example.
*
* PlantUML Parser
* ───────────────
* Parses PlantUML class diagrams into DomainMetamodel.
*
* Supported PlantUML syntax:
*
*   package "ContextName" <<BoundedContext>> { ... }
*   class ClassName <<Stereotype>> { fields / methods }
*   interface IClassName <<Repository>> { ... }
*   ClassName "1" *-- "0..*" OtherClass : label
*   ClassName --|> ParentRole          (role hierarchy, RBAC₁)
*
* DDD Stereotypes recognised (case-insensitive):
*   <<AggregateRoot>>  <<Entity>>  <<ValueObject>>
*   <<DomainService>>  <<DomainEvent>>  <<Repository>>
*   <<UseCase>>  <<Role>>
*
* Inside a <<Role>> class, each field line becomes a permission name:
*   class Admin <<Role>> {
*     MANAGE_STUDENTS
*     ENROLL_STUDENTS
*   }
*
* Field syntax:  [+|-|#] name: Type [= default]   (optional [] suffix = collection)
* Method syntax: [+|-|#] name(param: Type, ...): ReturnType
  */
