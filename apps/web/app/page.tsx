export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">RMIT ADC Hackathon · In Motion or Element</p>
      <h1>VSual</h1>
      <p className="intro">
        An on-demand browser assistant for blind and low-vision users, designed
        to complement your screen reader.
      </p>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Compare captured orders</h2>
        <p>
          Open the synthetic orders dashboard and use the VSual extension to ask
          about completed orders. Review the captured rows and the calculation
          behind each answer.
        </p>
        <p>
          Type a question or review a recorded transcript before submitting it.
          This controlled demo supports monthly order comparisons; browser
          actions and other websites are not supported.
        </p>
      </section>
      <p>
        <a href="/orders">Open synthetic orders dashboard</a>
      </p>
      <p>
        <a href="/voice">Open voice setup</a>
      </p>
      <p>
        <a href="/v1/health">View backend liveness (JSON)</a>
      </p>
    </main>
  );
}
