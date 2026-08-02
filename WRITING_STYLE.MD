# Writing Style

Use this style for Rostrum strategy, product, Epic, and task documentation.

## Start with the point

- State what the document or section establishes before explaining it.
- Describe the product as a platform for defining and executing workflows. Do not imply that prompt intake, workflow selection, or AI authorship are inherent platform behavior; they are capabilities a workflow may implement.
- Define scope primarily by stating what the document delivers. Do not enumerate obvious exclusions. State a boundary only when a reasonable reader might otherwise infer a materially different product or body of work.

## Explain work in operational terms

- Begin with a plain-language statement of what the work creates or changes.
- Translate abstract capabilities and contracts into the concrete questions they answer or operations they perform.
- State the observable end state: what will exist, work, or be provable when the work is complete.
- Name the artifact or behavior directly. Avoid relying on abstract verbs such as “support,” “enable,” “establish,” or “publish” without saying what is produced.
- A reader should be able to explain the work's purpose and end state without reading its acceptance criteria.

## Make the structure do the explaining

- Prefer short sections, tables, bullets, and diagrams only when they clarify a relationship better than prose.
- Use tables for ordered delivery, comparisons, ownership, dependencies, and “what / why / proof” views.
- Keep rows concrete and independently understandable. A reader should see why an item exists from its outcome, demonstration, or dependency.
- Organize plans in priority and dependency order. Each milestone should name the observable product state it unlocks.
- Link product-plan milestones to Epics. The connection from a plan to its next work should be evident from the table or structure, not asserted in explanatory prose.

## Be concise and specific

- Prefer direct language over narrative setup, framing, or storytelling.
- Write the minimum needed to support a decision or review. Remove repetition, broad claims, and implementation detail that belongs in a deeper document.
- Avoid product-marketing language and vague modifiers such as “powerful,” “seamless,” “robust,” or “comprehensive” unless the document defines what they mean.
- Use precise nouns and verbs: say what is defined, executed, observed, approved, simulated, or produced.

## Match detail to the document

| Document | Purpose | Appropriate detail |
| --- | --- | --- |
| High-level blueprint | Define the product shape, major components, and their relationships | Components, responsibilities, boundaries, and build direction |
| Product plan | Show the prioritized path to a complete product and the proof at each stage | Product states, delivery milestones, showcase outcomes, Epic links |
| Epic | Define a product state and the work required to deliver it | Capabilities, constraints, tasks, spikes, dependencies, risks, and exit criteria |
| Task | Define one bounded piece of delivery work | Concrete purpose, questions or operations, observable end state, dependencies, and acceptance criteria |

Do not use a higher-level document to substitute for a lower-level one. A product plan should not become a catalog of detailed requirements, and an Epic should not become a repository-level implementation plan.

## Treat examples as evidence, not the product definition

- Use example workflows to demonstrate platform completeness and expose requirements.
- Keep examples clearly subordinate to the generic workflow platform.
- State what each showcase proves and what it needs, rather than narrating the workflow step by step.

## Language and formatting

- Use “workflow” rather than “mode.” Use music-related names only when their meaning is immediately clear.
- Use headings that describe the reader’s question or the section’s outcome.
- Keep bullet points parallel and brief. Use full sentences when the item expresses a decision, constraint, or requirement.
- Prefer stable terms consistently; introduce an abbreviation only when it meaningfully improves readability.
- Do not create packaging or distribution concepts prematurely. Record a future decision without designing it when the decision is not yet in scope.
