import { createElement, type ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';

const parser = new MarkdownIt('commonmark', {
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
}).enable('strikethrough');

type ViewNode = {
  readonly tag: string;
  readonly text?: string;
  readonly href?: string;
  readonly start?: number;
  readonly children?: readonly ViewNode[];
};

const html = (tag: string, children: readonly ViewNode[] = []): ViewNode => ({ tag, children });
const text = (value: string): ViewNode => ({ tag: '#text', text: value });

function safeHref(value: string | null): string | undefined {
  if (!value || /[\u0000-\u001f\u007f]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)) return;
  try {
    const url = new URL(value);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && /^https?:\/\//iu.test(value) && url.hostname) return url.href;
    if (url.protocol === 'mailto:' && url.pathname) return url.href;
  } catch { /* Invalid or relative address remains plain text. */ }
}

const blockTags: Record<string, string> = {
  paragraph_open: 'p', bullet_list_open: 'ul', ordered_list_open: 'ol', list_item_open: 'li',
  blockquote_open: 'blockquote', heading_open: 'heading',
};

function inlineNodes(tokens: readonly Token[]): ViewNode[] {
  const output: ViewNode[] = [];
  const stack: { tag: string; href?: string; children: ViewNode[] }[] = [];
  const append = (node: ViewNode) => (stack.at(-1)?.children ?? output).push(node);
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'html_inline' || token.type === 'code_inline') {
      append(token.type === 'code_inline' ? { tag: 'code', children: [text(token.content)] } : text(token.content));
    } else if (token.type === 'image') {
      append(text(token.content));
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      append(html('br'));
    } else if (token.type === 'link_open') {
      const address = token.attrGet('href');
      const href = safeHref(address === null ? null : String(address));
      stack.push({ tag: href ? 'a' : 'span', href, children: [] });
    } else if (token.type === 'link_close') {
      const link = stack.pop();
      if (link) append({ tag: link.tag, href: link.href, children: link.children });
    } else if (token.type.endsWith('_open') && token.nesting === 1) {
      const tag = token.type.slice(0, -5);
      stack.push({ tag: ['strong', 'em', 's'].includes(tag) ? tag : 'span', children: [] });
    } else if (token.type.endsWith('_close') && token.nesting === -1) {
      const item = stack.pop();
      if (item) append({ tag: item.tag, children: item.children });
    } else if (token.content) append(text(token.content));
  }
  while (stack.length) {
    const item = stack.pop()!;
    output.push({ tag: item.tag, href: item.href, children: item.children });
  }
  return output;
}

function parseTokens(tokens: readonly Token[]): ViewNode[] {
  const output: ViewNode[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'inline') {
      output.push(...inlineNodes(token.children ?? []));
    } else if (token.type === 'fence' || token.type === 'code_block') {
      output.push({ tag: 'pre', children: [{ tag: 'code', children: [text(token.content)] }] });
    } else if (token.type === 'hr') {
      output.push(html('hr'));
    } else if (token.type === 'heading_open' || blockTags[token.type]) {
      const tag = token.type === 'heading_open' ? (token.tag === 'h1' || token.tag === 'h2' || token.tag === 'h3' ? token.tag : 'p') : blockTags[token.type];
      const children: Token[] = [];
      const start = index + 1;
      let depth = 1;
      index++;
      while (index < tokens.length && depth) {
        const child = tokens[index];
        if (child.nesting === 1) depth++;
        if (child.nesting === -1) depth--;
        if (depth) children.push(child);
        index++;
      }
      index--;
      output.push({ tag, start: tag === 'ol' && token.attrGet('start') ? Number(token.attrGet('start')) : undefined, children: parseTokens(children) });
      if (start > index) continue;
    } else if (token.type === 'inline' || token.type.endsWith('_close') || token.type === 'bullet_list_open' || token.type === 'ordered_list_open' || token.type === 'list_item_open') {
      continue;
    } else if (token.content) {
      output.push(text(token.content));
    }
  }
  return output;
}

function plainText(nodes: readonly ViewNode[]): string {
  return nodes.map(node => {
    if (node.tag === '#text') return node.text ?? '';
    const body = plainText(node.children ?? []);
    return ['p', 'h1', 'h2', 'h3', 'li', 'blockquote', 'pre'].includes(node.tag) ? `${body}\n` : body;
  }).join('');
}

export interface MarkdownViewModel {
  readonly nodes: readonly ViewNode[];
  readonly plainText: string;
}

export function parseMarkdown(source: string): MarkdownViewModel {
  try {
    const nodes = parseTokens(parser.parse(source, {}));
    return { nodes, plainText: plainText(nodes) };
  } catch {
    const nodes = [text(source)];
    return { nodes, plainText: source };
  }
}

const tags = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code', 'strong', 'em', 's', 'br', 'span', 'a']);

export function renderMarkdownNodes(nodes: readonly ViewNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.tag === '#text') return node.text;
    const tag = tags.has(node.tag) ? node.tag : 'span';
    const props = {
      ...(tag === 'a' && node.href ? { href: node.href, target: '_blank', rel: 'noopener noreferrer' } : {}),
      ...(tag === 'ol' && node.start && node.start > 1 ? { start: node.start } : {}),
    };
    if (tag === 'hr' || tag === 'br') return createElement(tag, { ...props, key: index });
    return createElement(tag, { ...props, key: index }, renderMarkdownNodes(node.children ?? []));
  });
}

const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:[-'’][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;

export function countWords(value: string): number {
  return [...value.matchAll(wordPattern)].length;
}
