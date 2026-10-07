declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';

  // The plugin has no options and operates on markdown-it's public extension API.
  function footnotePlugin(markdown: MarkdownIt): void;

  export = footnotePlugin;
}
