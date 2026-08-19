# Code samples and command lines

Use this guidance for code blocks, shell commands, terminal transcripts, configuration examples, and copyable snippets.

## Code samples

- Follow the repository and language style for indentation and syntax.
- Wrap lines at 80 characters when practical.
- Introduce a standalone sample with a complete sentence. Use a colon when the sample immediately follows.
- Make each sample runnable, or state its assumptions clearly.
- Show the smallest complete example that proves the point.
- Represent omitted code with a comment in the sample's language. Do not use `...` or a Unicode ellipsis for omitted code.
- Do not make an omitted sample click-to-copy.
- Verify output instead of inventing it.

## Command-line syntax

- Link the first mention of a command to its reference when one exists.
- Use a code span for a short command and a code block for a long command.
- Include only the arguments needed for the documented common task.
- Make copyable commands work without editing except for descriptive placeholder values.
- Do not put optional-argument brackets, alternatives, pipes, or repeating ellipses in a copyable command. Show separate commands or steps instead.
- In reference syntax, use `[OPTION]` for an optional argument, `{OPTION_A|OPTION_B}` for an exclusive choice, and `ARGUMENT ...` for a repeatable argument.
- Break long commands at safe separators and follow the shell's quoting and continuation rules.
- Use `$` for terminal input when showing multiple lines. Keep input and output in separate blocks and do not show the current directory in the prompt.

## Placeholders

Use descriptive uppercase placeholders with underscores, such as `` `*PROJECT_ID*` ``. Do not use `x`, `foo`, `bar`, `baz`, `MY_VALUE`, or `YOUR_VALUE` unless they are real technical terms. Explain every placeholder the first time it appears and use the same name throughout the example and output.

## Review checklist

- [ ] The sample is runnable or its assumptions are explicit.
- [ ] Omitted code uses a language comment, not an ellipsis.
- [ ] Copyable commands do not require syntax cleanup.
- [ ] Input and output are distinct.
- [ ] Every placeholder is descriptive, consistent, and explained.
- [ ] Output is observed or clearly labeled as illustrative.

Sources: [Google Code samples](https://developers.google.com/style/code-samples), [Command-line syntax](https://developers.google.com/style/code-syntax), and [Placeholders](https://developers.google.com/style/placeholders).
