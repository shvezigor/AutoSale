import type { ContentPage as ContentPageData } from '../content/pages';

export function ContentPage({ content }: { content: ContentPageData }) {
  return (
    <main id="main-content">
      <header className="content-hero"><div className="marketing-shell content-hero__inner"><h1>{content.title}</h1><p>{content.description}</p></div></header>
      {content.sections.map((section) => (
        <section className="content-section" key={section.title}>
          <div className="marketing-shell">
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            {section.items ? <div className="content-grid">{section.items.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div> : null}
          </div>
        </section>
      ))}
    </main>
  );
}
