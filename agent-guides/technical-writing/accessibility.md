# Accessible documentation

Use this guidance for UI instructions, HTML, images, diagrams, tables, forms, interactive elements, and content that must work across assistive technologies.

## Rules

- Preserve meaning without color, images, sound, animation, spatial position, or punctuation.
- Use semantic HTML and native controls instead of visual styling or custom controls when possible.
- Use a logical heading hierarchy and meaningful labels.
- Ensure readers can reach interactive content with a keyboard.
- Use descriptive link text and refer to visible labels or accessible names instead of visual icon shapes.
- Provide contextual alt text for informative images. Use `alt=""` for decorative images or images that duplicate nearby text.
- Do not put new information only in an image, table, symbol, or screenshot.
- Introduce tables and interactive elements in the surrounding text.
- Avoid directional descriptions such as "above," "below," "left panel," and "right-hand side." Use labels, headings, preceding content, or following content instead.
- Use `<kbd>` or the repository equivalent for keyboard keys.
- Use `aria-label` or the repository's equivalent treatment when documenting menu paths that use `>`.
- Label form fields and describe validation errors with both the problem and its fix.
- Prefer SVG for diagrams when practical. Provide captions, transcripts, or descriptions for audio, video, and animation.

## Review checklist

- [ ] The content remains understandable without visual cues.
- [ ] Headings, links, controls, fields, and tables have semantic structure.
- [ ] Images have appropriate alt text or an empty alt attribute when decorative.
- [ ] Interactive paths work with a keyboard.
- [ ] UI instructions use labels instead of position or icon shape.
- [ ] Tables are necessary, introduced, and have proper headings.

Source: [Google Write accessible documentation](https://developers.google.com/style/accessibility), [Semantic tagging](https://developers.google.com/style/semantic-tagging), and [W3C WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/).
