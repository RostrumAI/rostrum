# API reference

Use this guidance for public APIs, exported symbols, generated reference pages, and documentation comments.

## Coverage

Document every public class, interface, struct, union type, constant, field, enum, typedef, and method. Every method entry must describe its parameters, return value, and exceptions.

## Rules

- Start each class or interface with a short purpose statement that adds information beyond its name and signature.
- Start each method with a present-tense verb that describes its action.
- Use `Checks whether ...` for Boolean getters and `Gets the ...` for other getters when those forms fit.
- Use precise forms such as `Sets the ...`, `Updates the ...`, `Deletes ...`, `Registers ...`, `Called by ...`, or `Creates a ...` when they describe the operation.
- Explain prerequisites, permissions, dependencies, related APIs, important behavior, and pitfalls.
- Capitalize parameter descriptions and end them with a period. Start non-Boolean descriptions with `The` or `A` when possible.
- For action booleans, describe both values and their effects.
- For state booleans, use `True if ...; false otherwise.`
- Describe relevant ranges and default behavior, then state `Default:` and the default value.
- Start non-Boolean return descriptions with `The ...`. Use `True if ...; false otherwise.` for Boolean returns.
- Describe exceptions with `If ...` when the generator adds `Throws`; otherwise use `Thrown when ...`.
- Start deprecations with `Deprecated.`, name the replacement, and explain how existing code should migrate.
- Use code font and links for API names when the documentation system supports them.

## Review checklist

- [ ] Every public symbol has a description.
- [ ] Every method documents parameters, return value, exceptions, defaults, and relevant prerequisites.
- [ ] The first sentence is concise, unique, and useful in a generated summary.
- [ ] Boolean parameters and returns explain their semantics precisely.
- [ ] Deprecated APIs include a replacement and migration path.

Source: [Google API reference code comments](https://developers.google.com/style/api-reference-comments).
