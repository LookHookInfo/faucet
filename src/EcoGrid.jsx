import { ECO_ITEMS } from "./EcoItems";

function EcoCard({ item }) {
  const inner = (
    <>
      <div className="eco-logo">
        {item.logo ? (
          <img src={item.logo} alt={item.name} loading="lazy" />
        ) : (
          <span className="eco-glyph">{item.name.charAt(0)}</span>
        )}
      </div>
      <div className="eco-info">
        <div className="eco-name">{item.name}</div>
        {item.desc && <div className="eco-desc">{item.desc}</div>}
      </div>
    </>
  );

  if (item.url) {
    return (
      <a className="eco-card" href={item.url} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return <div className="eco-card">{inner}</div>;
}

export default function EcoGrid() {
  const top = ECO_ITEMS.filter(i => i.top);
  const rest = ECO_ITEMS.filter(i => !i.top);
  const ordered = [...top, ...rest];

  return (
    <section className="eco" id="ecosystem">
      <div className="eco-title">
        <h2>Ecosystem</h2>
        <p>Products & partners of Mining Hash</p>
      </div>
      <div className="eco-grid">
        {ordered.map(item => (
          <EcoCard key={item.name} item={item} />
        ))}
      </div>
    </section>
  );
}