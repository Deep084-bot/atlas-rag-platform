export function Panel({ eyebrow, title, description, children, action }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-atlas-panel p-6 shadow-glow backdrop-blur-xl md:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-atlas-teal/90">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">{title}</h2>
          {description && <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}