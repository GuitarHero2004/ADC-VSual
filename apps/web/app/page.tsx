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
        <h2 id="status-heading">Voice foundation</h2>
        <p>
          This demo site is running. The synthetic orders dashboard and grounded
          answers are not implemented yet.
        </p>
        <p>
          Test recorded speech, edit its transcript and read it back using
          ElevenLabs. Page analysis and browser actions will be connected later.
        </p>
      </section>
      <p>
        <a href="/voice">Open voice setup</a>
      </p>
      <p>
        <a href="/v1/health">View backend liveness (JSON)</a>
      </p>
    </main>
  );
}
