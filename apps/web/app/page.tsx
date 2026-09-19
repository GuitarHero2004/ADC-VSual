export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">RMIT ADC Hackathon · In Motion or Element</p>
      <h1>Browser Accessibility Agent</h1>
      <p className="intro">
        An on-demand browser assistant for blind and low-vision users, designed
        to complement your screen reader.
      </p>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Foundation only</h2>
        <p>
          This demo site is running. The synthetic orders dashboard and grounded
          answers are not implemented yet.
        </p>
        <p>
          The extension currently provides a side-panel shell. It cannot read
          this page, answer questions, record audio or perform browser actions.
        </p>
      </section>
      <p>
        <a href="/v1/health">View backend liveness (JSON)</a>
      </p>
    </main>
  );
}
