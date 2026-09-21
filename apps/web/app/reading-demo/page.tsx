import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Accessible meetings — VSual reading demo',
};

/** Synthetic, public text for repeatable structured-page acceptance checks. */
export default function ReadingDemo() {
  return (
    <main id="main-content" tabIndex={-1}>
      <article aria-labelledby="article-title">
        <h1 id="article-title">Accessible meetings</h1>
        <p>
          This synthetic article is a VSual reading example. It describes a
          fictional team’s meeting practices.
        </p>
        <section>
          <h2>Before the meeting</h2>
          <p>
            The facilitator shares an agenda and accessible documents before the
            meeting. Participants can request a text version of any visual
            material.
          </p>
          <ul>
            <li>Use descriptive headings in shared documents.</li>
            <li>
              Provide chart labels and the underlying figures when available.
            </li>
          </ul>
        </section>
        <section>
          <h2>During the meeting</h2>
          <p>
            Speakers introduce themselves and describe relevant visual changes.
            The facilitator leaves time for questions and avoids relying only on
            colour.
          </p>
        </section>
        <section>
          <h2>After the meeting</h2>
          <ol>
            <li>Publish agreed actions in an accessible text document.</li>
            <li>Ask participants whether the materials were usable.</li>
          </ol>
          <p>
            These practices are suggestions for the fictional team, not a claim
            that every participant has the same needs.
          </p>
        </section>
        <section>
          <h2>Excluded example content</h2>
          <p>
            The table below is deliberately outside this feature’s text-reading
            scope.
          </p>
          <table>
            <caption>
              Fictional attendance — not captured by structured page reading
            </caption>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Attendees</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Morning</th>
                <td>12</td>
              </tr>
              <tr>
                <th scope="row">Afternoon</th>
                <td>9</td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>
    </main>
  );
}
