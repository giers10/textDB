export function markdownToHTML(text) {
  // 0) Remove <think>...</think>/<thinking>...</thinking> blocks
  text = text.replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '');

  // Normalize exotic spaces (narrow/non-breaking) to regular spaces
  text = text.replace(/[\u00a0\u202f\u2007]/g, ' ');

  text = balanceStreamingCodeFence(text);

  const escapeHtml = (value = '') =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const escapeAttr = (value = '') =>
    escapeHtml(value)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const applyInline = (source) => {
    const codeRuns = [];
    let tmp = source.replace(/`([^`]+?)`/g, (_, code) => {
      const idx = codeRuns.push(code) - 1;
      return `@@CODEINLINE${idx}@@`;
    });

    const strongRuns = [];
    tmp = tmp.replace(/\*\*([\s\S]+?)\*\*/g, (_, content) => {
      const idx = strongRuns.push(content) - 1;
      return `@@STRONG${idx}@@`;
    });

    const emphasisRuns = [];
    tmp = tmp.replace(/(?<!\*)\*([\s\S]+?)\*(?!\*)/g, (_, content) => {
      const idx = emphasisRuns.push(content) - 1;
      return `@@EM${idx}@@`;
    });

    return tmp
      .replace(/@@STRONG(\d+)@@/g, (_, idx) => `<b>${strongRuns[+idx]}</b>`)
      .replace(/@@EM(\d+)@@/g, (_, idx) => `<i>${emphasisRuns[+idx]}</i>`)
      .replace(/@@CODEINLINE(\d+)@@/g, (_, idx) => `<code>${codeRuns[+idx]}</code>`);
  };

  // 1) Normalize line endings
  let tmp = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2) Extract code blocks and replace with placeholders (protect from all formatting)
  const codeblocks = [];
  const placeholder = (idx) => `@@CODEBLOCK${idx}@@`;

  tmp = tmp.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    let cleaned = (code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleaned.split('\n');
    while (lines.length > 0 && /^\s*$/.test(lines[lines.length - 1])) lines.pop();
    cleaned = lines.join('\n');
    codeblocks.push({ lang: (lang || '').trim(), code: cleaned });
    return placeholder(codeblocks.length - 1);
  });

  // 3) HTML-escape special characters (outside of fenced code blocks)
  let escaped = escapeHtml(tmp);

  // 4) Headings (with consistent hooks)
  escaped = escaped
    .replace(/^#### (.+)$/gm, '<h4 class="md-heading md-heading--4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="md-heading md-heading--3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-heading md-heading--2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-heading md-heading--1">$1</h1>');

  // 4.1) Horizontal rules: --- or *** or ___ on a line
  escaped = escaped.replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '<hr class="md-hr">');

  // 4.2) Ordered lists: lines starting with "1. ", "2. ", ...
  escaped = escaped.replace(
    /(^|\n)([ \t]*\d+\. .+(?:\n[ \t]*\d+\. .+)*)/g,
    (_, lead, listBlock) => {
      const items = listBlock
        .split(/\n/)
        .map((line) => line.replace(/^[ \t]*\d+\.\s+/, '').trim())
        .filter((item) => item.length > 0)
        .map((item) => `<li class="md-list__item">${item}</li>`)
        .join('');
      if (!items) return listBlock;
      return `${lead}<ol class="md-list md-list--ordered">${items}</ol>`;
    }
  );

  // 4.3) Blockquotes
  escaped = escaped.replace(
    /(^|\n)([ \t]*> .+(?:\n[ \t]*> .+)*)/g,
    (_, lead, blockquoteBlock) => {
      const lines = blockquoteBlock
        .split(/\n/)
        .map((line) => line.replace(/^[ \t]*>\s*/, '').trim())
        .join('\n');
      return `${lead}<blockquote class="md-blockquote">${lines}</blockquote>`;
    }
  );

  // 4.5) Unordered lists
  escaped = escaped.replace(
    /(^|\n)([ \t]*[-*] .+(?:\n[ \t]*[-*] .+)*)/g,
    (_, lead, listBlock) => {
      const items = listBlock
        .split(/\n/)
        .map((line) => line.replace(/^[ \t]*[-*]\s+/, '').trim())
        .filter((item) => item.length > 0)
        .map((item) => `<li class="md-list__item">${item}</li>`)
        .join('');
      if (!items) return listBlock;
      return `${lead}<ul class="md-list md-list--unordered">${items}</ul>`;
    }
  );

  // 4.6) Markdown tables (GitHub-style). Strict: requires header, separator, ≥2 cols.
  const mdTableBlockRe =
    /(^\|[^\n]*\|?\s*\n\|\s*[:\-]+(?:\s*\|\s*[:\-]+)+\s*\|?\s*\n(?:\|[^\n]*\|?\s*(?:\n|$))*)/gm;

  escaped = escaped.replace(mdTableBlockRe, (block) => {
    const hadTrailingNewline = /\n$/.test(block);
    const lines = block.replace(/\n$/, '').split('\n');

    const split = (line) => line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim());

    const headers = split(lines[0]);
    const seps = split(lines[1]);
    if (headers.length < 2 || seps.length < 2) return block;
    if (!seps.every((s) => /^[ :\-]+$/.test(s) && /-/.test(s))) return block;

    const aligns = seps.map((seg) => {
      const s = seg.replace(/\s+/g, '');
      const left = s.startsWith(':');
      const right = s.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      return 'left';
    });

    const bodyLines = lines.slice(2).filter((l) => /^\|/.test(l.trim()));
    const alignClass = (i) => `md-align-${aligns[i] || 'left'}`;

    const ths = headers
      .map(
        (h, i) =>
          `<th class="md-table__head-cell ${alignClass(i)}">${h}</th>`
      )
      .join('');

    const rows = bodyLines
      .map((line) => {
        const cells = split(line);
        const tds = cells
          .map(
            (c, i) =>
              `<td class="md-table__cell ${alignClass(i)}">${c}</td>`
          )
          .join('');
        return `<tr class="md-table__row">${tds}</tr>`;
      })
      .join('');

    const table = `<table class="md-table"><thead><tr class="md-table__row md-table__row--head">${ths}</tr></thead><tbody>${rows}</tbody></table>`;

    return table + (hadTrailingNewline ? '\n' : '');
  });

  // 5) Bold, italic, inline code
  let html = applyInline(escaped);

  // 5.5) Links
  const safeLink = (hrefRaw) => {
    const href = (hrefRaw || '').trim();
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (/^mailto:/i.test(href) || /^tel:/i.test(href)) return href;
    if (href.startsWith('/') || href.startsWith('#')) return href;
    return '';
  };

  html = html.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_, label, href) => {
    const url = safeLink(href);
    const tooltip = escapeHtml(href || '');
    if (!url) return label;
    return `<a class="md-link md-link--external" href="${escapeAttr(
      url
    )}" target="_blank" rel="noreferrer noopener"><span class="md-link__label">${label}</span> <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="md-icon md-icon-external"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg><span class="md-link__tooltip">${tooltip}</span></a>`;
  });

  // 6) Convert line-breaks to <br /> for NON-code content (preserve blank lines)
  html = html.replace(/\n/g, '<br />');

  // 6.1) Trim breaks around block elements (headings/lists/etc.) to avoid double spacing
  const brPattern = "<br\\s*\\/?>";
  const blockPattern = "(?:h[1-4]|hr|table|ul|ol|blockquote)";
  html = html
    .replace(
      new RegExp(`(${brPattern}\\s*)+(<(?:${blockPattern})\\b[^>]*>)`, "g"),
      "$2"
    )
    .replace(
      new RegExp(`(<\\/(?:${blockPattern})>)(?:\\s*${brPattern})+`, "g"),
      "$1"
    );

  // 6.2) Trim breaks around code blocks
  html = html
    .replace(new RegExp(`${brPattern}\\s*(?=<div class="md-codeblock"\\b)`, "g"), "")
    .replace(
      new RegExp(
        `(<div class="md-codeblock"[^>]*>[\\s\\S]*?<\\/div>)\\s*(?:${brPattern}\\s*)+`,
        "g"
      ),
      "$1"
    );

  // 7) Restore code blocks with header + copy button
  html = html.replace(/@@CODEBLOCK(\d+)@@/g, (_, idx) => {
    const { lang, code } = codeblocks[+idx];
    const title = (lang && lang.trim()) ? lang.trim() : 'code';
    const titleLabel = escapeHtml(title);
    const languageClass = title.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'code';

    const escapedCode = escapeHtml(code);
    const encodedForCopy = encodeURIComponent(code);

    const head = `<div class="md-codeblock__header"><div class="md-codeblock__lang">${titleLabel}</div><button type="button" class="md-codeblock__copy" aria-label="Copy code" title="Copy code" data-copy-code="${escapeAttr(
      encodedForCopy
    )}"><svg class="md-icon md-icon-copy" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg></button></div>`;

    const body = `<pre class="md-codeblock__pre"><code class="md-codeblock__code language-${languageClass}">${escapedCode}</code></pre>`;

    return `<div class="md-codeblock">${head}${body}</div>`;
  });

  return html;
}

// Virtually close an unfinished fenced code block so it renders during streaming.
function balanceStreamingCodeFence(md) {
  const lines = md.split(/\r?\n/);
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!open) {
      const m = line.match(/^\s*([`~]{3,})([^\s]*)?.*$/);
      if (m) {
        open = { fenceChar: m[1][0], fenceLen: m[1].length };
        continue;
      }
    } else {
      const re = new RegExp(
        `^\\s*(${open.fenceChar}{${open.fenceLen},})\\s*$`
      );
      if (re.test(line)) {
        open = null;
        continue;
      }
    }
  }

  if (open) {
    const virtual = `${open.fenceChar.repeat(open.fenceLen)}`;
    return md.endsWith('\n') ? md + virtual : md + '\n' + virtual;
  }

  return md;
}
