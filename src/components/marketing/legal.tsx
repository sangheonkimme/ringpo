export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-12 md:py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em]">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">시행일: {updated}</p>
      <div className="mt-8 space-y-6 text-sm leading-7 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-secondary [&_table]:bg-card [&_th]:p-2 [&_ul]:list-disc">
        {children}
      </div>
    </article>
  );
}

export function Placeholder({ value, label }: { value: string; label: string }) {
  return value ? <>{value}</> : <span className="rounded bg-yellow-100 px-1 text-yellow-900">[{label} 입력 필요]</span>;
}
