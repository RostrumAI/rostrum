# HTML and Markdown

Use this guidance when choosing between Markdown and HTML or writing semantic HTML and CSS-backed documentation.

## Choose the format

- Use the format required by the surrounding document, template, and renderer.
- Prefer Markdown when it expresses the content cleanly.
- Use semantic HTML when Markdown cannot express the required meaning or accessibility behavior.
- Do not mix formats merely for visual styling.

## Semantic markup

- Use elements for their meaning, not their default appearance.
- Use headings for document hierarchy, lists for lists, tables for two-dimensional data, `em` for emphasis, and `strong` for strong importance.
- Use `i` and `b` only for non-semantic visual treatments required by the format. Do not use heading levels, tables, frames, or `<br>` elements solely to control appearance.
- Use `<code>` for code and `<pre>` for preformatted blocks. Use `<kbd>` for keyboard input.
- Use native buttons, labels, form controls, and links instead of custom elements when possible.

## HTML formatting and CSS

Keep markup readable and preserve the document's existing formatting conventions. Use CSS for layout and visual styling rather than semantic elements selected for size or appearance. Do not override global font, size, or color styles inline to create emphasis. Ensure custom styles preserve reading order, keyboard access, and sufficient color contrast.

## Review checklist

- [ ] The chosen format is supported by the surrounding document and renderer.
- [ ] HTML elements express semantic meaning rather than appearance.
- [ ] Markdown and HTML are not mixed for decorative styling.
- [ ] Code, keyboard input, emphasis, lists, tables, and controls use the correct elements.
- [ ] CSS does not hide content from assistive technology or change reading order.
- [ ] Visual styling does not carry meaning without an accessible text or semantic cue.

Sources: [HTML and semantic tagging](https://developers.google.com/style/semantic-tagging), [HTML formatting](https://developers.google.com/style/html-formatting), [Markdown versus HTML](https://developers.google.com/style/markdown), and [MDN semantic HTML](https://developer.mozilla.org/en-US/docs/Glossary/Semantics#Semantics).
