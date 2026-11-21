import type { MDXComponents } from "mdx/types";
import Link from "next/link";

/** How Markdown renders in the docs (/docs): the Aevify light theme. */
const components: MDXComponents = {
  h1: (props) => <h1 className="mb-4 text-3xl font-medium tracking-tight text-ink sm:text-4xl" {...props} />,
  h2: (props) => <h2 className="mb-3 mt-12 border-t border-line pt-8 text-xl font-medium tracking-tight text-ink" {...props} />,
  h3: (props) => <h3 className="mb-2 mt-8 text-base font-medium text-ink" {...props} />,
  p: (props) => <p className="my-4 leading-7 text-slate-600" {...props} />,
  a: ({ href = "", ...props }) =>
    href.startsWith("/") ? (
      <Link href={href} className="font-medium text-brand-600 underline-offset-4 hover:underline" {...props} />
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline-offset-4 hover:underline" {...props} />
    ),
  ul: (props) => <ul className="my-4 list-disc space-y-1.5 pl-5 leading-7 text-slate-600 marker:text-ink-faint" {...props} />,
  ol: (props) => <ol className="my-4 list-decimal space-y-1.5 pl-5 leading-7 text-slate-600 marker:text-ink-faint" {...props} />,
  li: (props) => <li className="pl-1" {...props} />,
  strong: (props) => <strong className="font-medium text-ink" {...props} />,
  blockquote: (props) => (
    <blockquote className="my-6 rounded-xl border border-brand-200 bg-brand-50 px-5 py-1 text-sm text-brand-700 [&_p]:text-brand-700" {...props} />
  ),
  hr: () => <hr className="my-10 border-line" />,
  code: (props) => <code className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[0.85em] text-ink [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-slate-200" {...props} />,
  pre: (props) => <pre className="my-5 overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[13px] leading-relaxed text-slate-200" {...props} />,
  table: (props) => (
    <div className="my-6 overflow-x-auto rounded-xl border border-line">
      {/* Tables written with an empty header row ("| | |") don't show it. */}
      <table className="w-full text-left text-sm [&_thead:not(:has(th:not(:empty)))]:hidden" {...props} />
    </div>
  ),
  thead: (props) => <thead className="border-b border-line bg-surface-muted text-xs uppercase tracking-wider text-ink-muted" {...props} />,
  th: (props) => <th className="px-4 py-2.5 font-medium" {...props} />,
  td: (props) => <td className="border-t border-line px-4 py-2.5 align-top text-slate-600" {...props} />,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
