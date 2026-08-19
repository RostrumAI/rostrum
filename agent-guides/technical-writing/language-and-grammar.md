# Language and grammar

Use this guidance for sentence-level prose, terminology explanations, instructions, reference descriptions, and claims about software behavior.

## General sentence rules

- Put the subject and verb near the beginning. Prefer subject, verb, object order.
- Put a condition, context, or goal before the instruction it controls.
- Use short sentences when they contain multiple actions, conditions, or ideas. Split them when the structure becomes difficult to scan.
- Keep pronoun antecedents unambiguous. Follow `this` or `these` with a noun when needed.
- Use `that` for a restrictive clause and `which` for a nonrestrictive clause with a comma.
- Repeat a noun, article, or helper word when it removes ambiguity or improves translation.
- Do not use a casing-style name as a requirement. State the actual pattern and show an example.

## Voice, tense, and person

- Use active voice when the actor matters. Passive voice is acceptable when the object matters more, the actor is irrelevant, or the result is the focus.
- Use present tense for general behavior and current reference descriptions.
- Use future tense only for a delayed result caused by a documented future event. Do not use `will` for an unimplemented feature.
- Address the reader as `you` and `your` for instructions. Use `we` only when the organization is the clear subject.
- Use third person for software behavior and when distinguishing an end user from the reader.
- Do not attribute human thoughts, feelings, speech, or intent to software or hardware. Describe the operation literally.

## Requirements and recommendations

- Use an imperative or `must` for required actions.
- Use explicit recommendation language such as `We recommend` when an action is optional advice.
- Use `can` for ability or permission.
- Use `might` or `can` for a possible outcome.
- State an expected outcome directly.
- Do not use `should` when it could mean either a requirement, an observed behavior, or a recommendation.

## Articles, contractions, and pronouns

- Use `a` or `an` according to the next word's sound, not its first letter.
- Use common contractions when they sound natural. Do not force contractions into formal reference entries.
- Define an abbreviation on first use when readers might not know it, then use the abbreviation consistently.
- Avoid `i.e.`, `e.g.`, `aka`, `etc.`, and `and/or` in normal prose. Use `that is`, `for example`, `also known as`, a precise list, or an explicit alternative.
- Use singular `they` when gender is irrelevant. Make every pronoun's antecedent clear.

## Reference verbs and terminology

Start API and reference descriptions with the verb that states the operation. Use `Checks whether ...` for Boolean getters, `Gets the ...` for other getters, `Sets the ...`, `Updates the ...`, `Deletes ...`, `Registers ...`, `Called by ...`, or `Creates a ...` when accurate. See `api-reference.md` for complete API coverage.

Use precise terms instead of unexplained jargon. If a domain term is necessary, define it, link it, or use it consistently. Do not use a vague authority such as “experts say” without a specific source. When summarizing third-party material, identify the source, preserve its meaning, and do not present the third party's claims as repository facts.

## Capitalization and pluralization

- Use American English capitalization for ordinary prose and sentence case for headings, labels, and navigation.
- Preserve official capitalization for products, organizations, APIs, languages, libraries, UI labels, and code identifiers.
- Do not capitalize an ordinary feature name unless its official name requires it.
- Do not use a product or feature name as a verb unless the product documentation explicitly does so.
- Use a singular class or API name when referring to the type. Add a noun such as `objects` or `instances` when a plural is needed.
- Keep possessives clear. Use the project's established form for product and code names.

## Review checklist

- [ ] The actor, action, condition, and result are clear.
- [ ] Voice, tense, person, and requirement strength match the intended meaning.
- [ ] Software is described literally rather than anthropomorphically.
- [ ] Articles, contractions, pronouns, abbreviations, and clauses are unambiguous.
- [ ] Jargon and third-party claims are defined, sourced, or removed.
- [ ] Capitalization, pluralization, and possessives match project conventions.

Sources: [Abbreviations](https://developers.google.com/style/abbreviations), [Active voice](https://developers.google.com/style/voice), [Anthropomorphism](https://developers.google.com/style/anthropomorphism), [Articles](https://developers.google.com/style/articles), [Capitalization](https://developers.google.com/style/capitalization), [Contractions](https://developers.google.com/style/contractions), [Pluralization](https://developers.google.com/style/pluralization), [Possessives](https://developers.google.com/style/possessives), [Prepositions](https://developers.google.com/style/prepositions), [Present tense](https://developers.google.com/style/tense), [Pronouns](https://developers.google.com/style/pronouns), [Second person](https://developers.google.com/style/person), [Sentence structure](https://developers.google.com/style/sentence-structure), [Verbs in reference documents](https://developers.google.com/style/reference-verbs), [Jargon](https://developers.google.com/style/jargon), [Prescriptive documentation](https://developers.google.com/style/prescriptive-documentation), and [Third-party content](https://developers.google.com/style/other-sources).
